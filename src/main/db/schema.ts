import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
  /**
   * Set when the migration rebuilds a table other tables reference. The runner turns
   * foreign keys off around it and runs `PRAGMA foreign_key_check` afterwards.
   */
  disableForeignKeys?: boolean
}

/**
 * Migrations are append-only. Never edit a shipped one — add another.
 * `user_version` tracks which have run.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: (db) => {
      db.exec(`
        CREATE TABLE suppliers (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          contact         TEXT,
          phone           TEXT,
          email           TEXT,
          address         TEXT,
          lead_time_days  INTEGER,
          notes           TEXT,
          archived_at     INTEGER,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_suppliers_name ON suppliers(lower(name));

        CREATE TABLE items (
          id                  TEXT PRIMARY KEY,
          code                TEXT NOT NULL,
          name                TEXT NOT NULL,
          unit                TEXT NOT NULL DEFAULT 'Nos.',
          type                TEXT NOT NULL CHECK (type IN ('RM','FG')),
          opening_stock       REAL NOT NULL DEFAULT 0,
          reorder_level       REAL NOT NULL DEFAULT 0,
          net_weight          REAL,
          gross_weight        REAL,
          packing_box_details TEXT,
          quantity_packed     REAL,
          location            TEXT,
          supplier_id         TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
          notes               TEXT,
          search_blob         TEXT NOT NULL DEFAULT '',
          archived_at         INTEGER,
          created_at          INTEGER NOT NULL,
          updated_at          INTEGER NOT NULL
        );
        -- Item codes are the join key the whole workbook relies on, so they are unique
        -- case-insensitively: "rm-01" and "RM-01" are the same part.
        CREATE UNIQUE INDEX idx_items_code ON items(lower(code));
        CREATE INDEX idx_items_type ON items(type);
        CREATE INDEX idx_items_supplier ON items(supplier_id);
        CREATE INDEX idx_items_archived ON items(archived_at);

        CREATE TABLE bom_lines (
          id            TEXT PRIMARY KEY,
          fg_item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          rm_item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          qty_per_unit  REAL NOT NULL CHECK (qty_per_unit > 0),
          scrap_percent REAL NOT NULL DEFAULT 0,
          notes         TEXT,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        -- One line per parent/component pair: a component listed twice is a data entry
        -- slip, not two requirements.
        CREATE UNIQUE INDEX idx_bom_pair ON bom_lines(fg_item_id, rm_item_id);
        CREATE INDEX idx_bom_fg ON bom_lines(fg_item_id);
        CREATE INDEX idx_bom_rm ON bom_lines(rm_item_id);

        CREATE TABLE orders (
          id           TEXT PRIMARY KEY,
          order_no     TEXT NOT NULL,
          order_date   INTEGER NOT NULL,
          fg_item_id   TEXT NOT NULL REFERENCES items(id),
          qty_ordered  REAL NOT NULL CHECK (qty_ordered > 0),
          status       TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','planned','in_production','completed','cancelled')),
          customer     TEXT,
          due_date     INTEGER,
          notes        TEXT,
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_orders_no ON orders(lower(order_no));
        CREATE INDEX idx_orders_status ON orders(status);
        CREATE INDEX idx_orders_fg ON orders(fg_item_id);
        CREATE INDEX idx_orders_due ON orders(due_date);

        -- The ledger. Everything about stock is derived from this table plus each
        -- item's opening balance; nothing caches a quantity.
        CREATE TABLE stock_moves (
          id            TEXT PRIMARY KEY,
          moved_at      INTEGER NOT NULL,
          direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
          item_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          qty           REAL NOT NULL CHECK (qty > 0),
          reason        TEXT NOT NULL DEFAULT 'other',
          reference_no  TEXT,
          order_id      TEXT REFERENCES orders(id) ON DELETE SET NULL,
          remarks       TEXT,
          voided_at     INTEGER,
          voided_reason TEXT,
          created_at    INTEGER NOT NULL
        );
        -- The shape every stock query uses: live rows for one item.
        CREATE INDEX idx_moves_item_live ON stock_moves(item_id, voided_at, direction);
        CREATE INDEX idx_moves_when ON stock_moves(moved_at DESC);
        CREATE INDEX idx_moves_order ON stock_moves(order_id);
        CREATE INDEX idx_moves_reason ON stock_moves(reason);

        CREATE TABLE plans (
          id             TEXT PRIMARY KEY,
          order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          note           TEXT,
          total_shortage REAL NOT NULL DEFAULT 0,
          line_count     INTEGER NOT NULL DEFAULT 0,
          -- Only the live (non-superseded) plan commits stock, so re-planning an order
          -- cannot double-count its own requirement.
          superseded_at  INTEGER,
          created_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_plans_order ON plans(order_id, superseded_at);

        CREATE TABLE plan_lines (
          id              TEXT PRIMARY KEY,
          plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          rm_item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          qty_required    REAL NOT NULL,
          stock_available REAL NOT NULL,
          shortage        REAL NOT NULL,
          already_issued  REAL NOT NULL DEFAULT 0,
          depth           INTEGER NOT NULL DEFAULT 1,
          supplier_id     TEXT REFERENCES suppliers(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_plan_lines_plan ON plan_lines(plan_id);
        CREATE INDEX idx_plan_lines_item ON plan_lines(rm_item_id);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)

      // Stock per item, straight from the ledger. This is the whole replacement for the
      // workbook's Stock_Register sheet: 774 rows of full-column SUMIFS become one
      // indexed aggregate, and the item list can no longer drift out of sync.
      db.exec(`
        CREATE VIEW item_stock AS
        SELECT
          i.id                                     AS item_id,
          i.opening_stock                          AS opening_stock,
          COALESCE(m.total_in, 0)                  AS total_inward,
          COALESCE(m.total_out, 0)                 AS total_outward,
          i.opening_stock + COALESCE(m.total_in, 0) - COALESCE(m.total_out, 0) AS current_stock,
          m.last_moved_at                          AS last_moved_at
        FROM items i
        LEFT JOIN (
          SELECT
            item_id,
            SUM(CASE WHEN direction = 'in'  THEN qty ELSE 0 END) AS total_in,
            SUM(CASE WHEN direction = 'out' THEN qty ELSE 0 END) AS total_out,
            MAX(moved_at)                                        AS last_moved_at
          FROM stock_moves
          WHERE voided_at IS NULL
          GROUP BY item_id
        ) m ON m.item_id = i.id;
      `)

      // What live plans have promised but not yet issued, per item. This is the concept
      // the workbook had no room for, and the reason two orders could quietly allocate
      // the same raw material.
      db.exec(`
        CREATE VIEW item_committed AS
        SELECT
          pl.rm_item_id AS item_id,
          SUM(MAX(pl.qty_required - pl.already_issued, 0)) AS committed
        FROM plan_lines pl
        JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
        JOIN orders o ON o.id = p.order_id
        WHERE o.status IN ('draft','planned','in_production')
        GROUP BY pl.rm_item_id;
      `)
    }
  }
]

migrations.push({
  version: 2,
  name: 'item-types-suppliers-photos-rack',
  // `items` carries a CHECK on `type` that has to widen, and SQLite cannot alter a
  // CHECK in place, so the table is rebuilt. Everything else that changes shape is
  // folded into the same rebuild rather than spread over several migrations.
  disableForeignKeys: true,
  up: (db) => {
    // The views read `items`, and `ALTER TABLE ... RENAME` refuses to run while a view
    // references a table that has been dropped. Drop them first, rebuild, put them back.
    db.exec('DROP VIEW IF EXISTS item_committed')
    db.exec('DROP VIEW IF EXISTS item_stock')

    // Park the one-supplier-per-item links before the old table goes, so they can be
    // replayed into item_suppliers once it exists.
    db.exec(`
      CREATE TEMP TABLE carried_suppliers AS
      SELECT id AS item_id, supplier_id, created_at, updated_at
        FROM items
       WHERE supplier_id IS NOT NULL;
    `)

    db.exec(`
      CREATE TABLE items_new (
        id                  TEXT PRIMARY KEY,
        code                TEXT NOT NULL,
        name                TEXT NOT NULL,
        unit                TEXT NOT NULL DEFAULT 'Nos.',
        -- Widened from RM/FG. WIP is a sub-assembly, BOUGHT_OUT is bought finished and
        -- resold, CONSUMABLE is used up without being part of a product, ASSET is
        -- tooling and equipment that is held rather than consumed.
        type                TEXT NOT NULL
                            CHECK (type IN ('RM','WIP','FG','BOUGHT_OUT','CONSUMABLE','ASSET')),
        opening_stock       REAL NOT NULL DEFAULT 0,
        reorder_level       REAL NOT NULL DEFAULT 0,
        net_weight          REAL,
        gross_weight        REAL,
        packing_box_details TEXT,
        quantity_packed     REAL,
        location            TEXT,
        -- Finer than location: the shelf or rack within it. Pick lists walk
        -- location first, then rack, so the route follows the building.
        rack                TEXT,
        notes               TEXT,
        search_blob         TEXT NOT NULL DEFAULT '',
        archived_at         INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );
    `)

    db.exec(`
      INSERT INTO items_new (
        id, code, name, unit, type, opening_stock, reorder_level, net_weight, gross_weight,
        packing_box_details, quantity_packed, location, rack, notes, search_blob,
        archived_at, created_at, updated_at
      )
      SELECT id, code, name, unit, type, opening_stock, reorder_level, net_weight, gross_weight,
             packing_box_details, quantity_packed, location, NULL, notes, search_blob,
             archived_at, created_at, updated_at
        FROM items;
    `)

    // `supplier_id` lived on the item, which allowed exactly one supplier per part.
    // It is replaced by item_suppliers below, so it does not survive the rebuild.
    db.exec('DROP TABLE items')
    db.exec('ALTER TABLE items_new RENAME TO items')

    db.exec(`
      CREATE UNIQUE INDEX idx_items_code ON items(lower(code));
      CREATE INDEX idx_items_type ON items(type);
      CREATE INDEX idx_items_archived ON items(archived_at);
      CREATE INDEX idx_items_location ON items(location, rack);
    `)

    /**
     * A part can be bought from several suppliers, so the link is its own row and
     * carries the facts that differ per vendor: their part number, their price, and
     * their lead time for this specific item.
     *
     * Exactly one link per item is `is_preferred`, which is the one purchasing groups a
     * shortage under — listing a shortage against every possible supplier would
     * multiply the quantity to buy.
     */
    db.exec(`
      CREATE TABLE item_suppliers (
        id             TEXT PRIMARY KEY,
        item_id        TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        supplier_id    TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        is_preferred   INTEGER NOT NULL DEFAULT 0,
        supplier_sku   TEXT,
        unit_price     REAL,
        lead_time_days INTEGER,
        notes          TEXT,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_item_suppliers_pair ON item_suppliers(item_id, supplier_id);
      CREATE INDEX idx_item_suppliers_item ON item_suppliers(item_id, is_preferred DESC);
      CREATE INDEX idx_item_suppliers_supplier ON item_suppliers(supplier_id);
    `)

    /**
     * Photos live in their own table so `SELECT i.*` can never accidentally drag
     * megabytes of image data into a list query. Two sizes are kept: a small thumbnail
     * cheap enough to show in a table, and one bounded full copy for the detail view.
     * Both are downscaled in the renderer before they ever reach here.
     */
    db.exec(`
      CREATE TABLE item_photos (
        item_id    TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        mime       TEXT NOT NULL,
        thumb      BLOB NOT NULL,
        full       BLOB NOT NULL,
        width      INTEGER,
        height     INTEGER,
        bytes      INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)

    db.exec(`
      CREATE VIEW item_stock AS
      SELECT
        i.id                                     AS item_id,
        i.opening_stock                          AS opening_stock,
        COALESCE(m.total_in, 0)                  AS total_inward,
        COALESCE(m.total_out, 0)                 AS total_outward,
        i.opening_stock + COALESCE(m.total_in, 0) - COALESCE(m.total_out, 0) AS current_stock,
        m.last_moved_at                          AS last_moved_at
      FROM items i
      LEFT JOIN (
        SELECT
          item_id,
          SUM(CASE WHEN direction = 'in'  THEN qty ELSE 0 END) AS total_in,
          SUM(CASE WHEN direction = 'out' THEN qty ELSE 0 END) AS total_out,
          MAX(moved_at)                                        AS last_moved_at
        FROM stock_moves
        WHERE voided_at IS NULL
        GROUP BY item_id
      ) m ON m.item_id = i.id;
    `)

    db.exec(`
      CREATE VIEW item_committed AS
      SELECT
        pl.rm_item_id AS item_id,
        SUM(MAX(pl.qty_required - pl.already_issued, 0)) AS committed
      FROM plan_lines pl
      JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
      JOIN orders o ON o.id = p.order_id
      WHERE o.status IN ('draft','planned','in_production')
      GROUP BY pl.rm_item_id;
    `)

    /** The single supplier each item used to point at becomes its preferred link. */
    db.exec(`
      INSERT INTO item_suppliers (id, item_id, supplier_id, is_preferred, created_at, updated_at)
      SELECT 'isup_' || lower(hex(randomblob(7))), c.item_id, c.supplier_id, 1, c.created_at, c.updated_at
        FROM carried_suppliers c
        JOIN items i     ON i.id = c.item_id
        JOIN suppliers s ON s.id = c.supplier_id;
    `)
    db.exec('DROP TABLE carried_suppliers')
  }
})

migrations.push({
  version: 3,
  name: 'packing-boxes',
  up: (db) => {
    /**
     * Packing box sizes, managed as a list rather than retyped per item.
     *
     * `packing_box_details` was free text, so the same carton arrived as
     * "Carton 300x200x150", "carton 300×200×150" and "300*200*150" — three strings the
     * database saw as three different boxes. As a list it is chosen once, named once,
     * and the dimensions are real numbers that carton counts and freight can use.
     *
     * A typed table rather than a generic key-value lookup: a box has dimensions and a
     * weight of its own, and those would be lost in a bag of strings.
     */
    db.exec(`
      CREATE TABLE packing_boxes (
        id           TEXT PRIMARY KEY,
        label        TEXT NOT NULL,
        length_mm    REAL,
        width_mm     REAL,
        height_mm    REAL,
        /** The empty box's own weight, which is part of what ships. */
        empty_weight REAL,
        notes        TEXT,
        sort_index   INTEGER NOT NULL DEFAULT 0,
        archived_at  INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_packing_boxes_label ON packing_boxes(lower(label));
    `)

    db.exec('ALTER TABLE items ADD COLUMN packing_box_id TEXT REFERENCES packing_boxes(id) ON DELETE SET NULL')

    // Every distinct value anyone had already typed becomes a box, so nothing that was
    // recorded is lost when the field stops being free text.
    db.exec(`
      INSERT INTO packing_boxes (id, label, sort_index, created_at, updated_at)
      SELECT 'pbx_' || lower(hex(randomblob(7))),
             TRIM(packing_box_details),
             ROW_NUMBER() OVER (ORDER BY TRIM(packing_box_details)),
             strftime('%s','now') * 1000,
             strftime('%s','now') * 1000
        FROM (SELECT DISTINCT TRIM(packing_box_details) AS packing_box_details
                FROM items
               WHERE packing_box_details IS NOT NULL AND TRIM(packing_box_details) != '');
    `)

    db.exec(`
      UPDATE items
         SET packing_box_id = (
               SELECT b.id FROM packing_boxes b
                WHERE lower(b.label) = lower(TRIM(items.packing_box_details))
             )
       WHERE packing_box_details IS NOT NULL AND TRIM(packing_box_details) != '';
    `)

    db.exec('ALTER TABLE items DROP COLUMN packing_box_details')
    db.exec('CREATE INDEX idx_items_packing_box ON items(packing_box_id)')
  }
})

export const LATEST_VERSION = migrations[migrations.length - 1]!.version
