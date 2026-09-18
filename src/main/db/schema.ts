import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
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

export const LATEST_VERSION = migrations[migrations.length - 1]!.version
