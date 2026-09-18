import type { Item, ItemQuery, ItemType, ItemWithStock } from '@shared/types'
import type { ItemInput } from '@shared/api'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'

interface ItemRow {
  id: string
  code: string
  name: string
  unit: string
  type: string
  opening_stock: number
  reorder_level: number
  net_weight: number | null
  gross_weight: number | null
  packing_box_details: string | null
  quantity_packed: number | null
  location: string | null
  supplier_id: string | null
  notes: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

type StockRow = ItemRow & {
  supplier_name: string | null
  total_inward: number | null
  total_outward: number | null
  current_stock: number | null
  committed: number | null
  last_moved_at: number | null
  used_in_bom_count: number | null
}

function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    unit: r.unit,
    type: r.type as ItemType,
    openingStock: r.opening_stock,
    reorderLevel: r.reorder_level,
    netWeight: r.net_weight,
    grossWeight: r.gross_weight,
    packingBoxDetails: r.packing_box_details,
    quantityPacked: r.quantity_packed,
    location: r.location,
    supplierId: r.supplier_id,
    notes: r.notes,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function toItemWithStock(r: StockRow): ItemWithStock {
  const currentStock = round(r.current_stock ?? r.opening_stock)
  const committed = round(r.committed ?? 0)
  const freeStock = round(currentStock - committed)
  const reorderLevel = r.reorder_level
  return {
    ...toItem(r),
    supplierName: r.supplier_name,
    totalInward: round(r.total_inward ?? 0),
    totalOutward: round(r.total_outward ?? 0),
    currentStock,
    committed,
    freeStock,
    // A reorder level of 0 means "not configured" rather than "alert at zero"; the
    // workbook left the column blank for most items and an alert on every one of them
    // would be noise nobody reads.
    belowReorder: reorderLevel > 0 && freeStock <= reorderLevel,
    usedInBomCount: r.used_in_bom_count ?? 0,
    lastMovedAt: r.last_moved_at
  }
}

/**
 * Everything an item row needs, in one statement. `item_stock` and `item_committed`
 * are views over the ledger and the live plans, so no quantity is ever cached.
 */
const SELECT_WITH_STOCK = `
  SELECT i.*,
         s.name AS supplier_name,
         st.total_inward, st.total_outward, st.current_stock, st.last_moved_at,
         c.committed,
         (SELECT COUNT(DISTINCT b.fg_item_id) FROM bom_lines b WHERE b.rm_item_id = i.id) AS used_in_bom_count
    FROM items i
    LEFT JOIN suppliers s      ON s.id = i.supplier_id
    LEFT JOIN item_stock st    ON st.item_id = i.id
    LEFT JOIN item_committed c ON c.item_id = i.id`

function searchBlob(item: {
  code: string
  name: string
  location?: string | null
  notes?: string | null
  packingBoxDetails?: string | null
}): string {
  return [item.code, item.name, item.location ?? '', item.notes ?? '', item.packingBoxDetails ?? '']
    .join(' ')
    .toLowerCase()
}

export const itemsRepo = {
  get(id: string): ItemWithStock | null {
    const row = queryOne<StockRow>(`${SELECT_WITH_STOCK} WHERE i.id = ?`, [id])
    return row ? toItemWithStock(row) : null
  },

  getPlain(id: string): Item | null {
    const row = queryOne<ItemRow>('SELECT * FROM items WHERE id = ?', [id])
    return row ? toItem(row) : null
  },

  byCode(code: string): ItemWithStock | null {
    const row = queryOne<StockRow>(`${SELECT_WITH_STOCK} WHERE lower(i.code) = ?`, [code.trim().toLowerCase()])
    return row ? toItemWithStock(row) : null
  },

  create(input: ItemInput): { item: Item; duplicate: boolean } {
    const code = input.code.trim()
    if (!code) throw new Error('An item code is required')
    const name = input.name.trim() || code

    const existing = itemsRepo.byCode(code)
    if (existing) return { item: existing, duplicate: true }

    const now = Date.now()
    const id = ids.item()
    run(
      `INSERT INTO items (
         id, code, name, unit, type, opening_stock, reorder_level, net_weight, gross_weight,
         packing_box_details, quantity_packed, location, supplier_id, notes, search_blob,
         archived_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        code,
        name,
        input.unit?.trim() || 'Nos.',
        input.type,
        round(input.openingStock ?? 0),
        round(input.reorderLevel ?? 0),
        input.netWeight ?? null,
        input.grossWeight ?? null,
        input.packingBoxDetails?.trim() || null,
        input.quantityPacked ?? null,
        input.location?.trim() || null,
        input.supplierId ?? null,
        input.notes?.trim() || null,
        searchBlob({ ...input, code, name }),
        now,
        now
      ]
    )
    return { item: itemsRepo.getPlain(id)!, duplicate: false }
  },

  update(id: string, patch: Partial<ItemInput>): Item | null {
    const current = itemsRepo.getPlain(id)
    if (!current) return null

    const next = { ...current }
    const sets: string[] = []
    const params: unknown[] = []
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      params.push(value)
    }

    if (patch.code !== undefined) {
      const code = patch.code.trim()
      if (!code) throw new Error('An item code is required')
      const clash = itemsRepo.byCode(code)
      if (clash && clash.id !== id) throw new Error(`${clash.name} already uses the code ${code}`)
      next.code = code
      push('code', code)
    }
    if (patch.name !== undefined) {
      next.name = patch.name.trim() || current.name
      push('name', next.name)
    }
    if (patch.unit !== undefined) push('unit', patch.unit.trim() || current.unit)
    if (patch.type !== undefined) push('type', patch.type)
    if (patch.openingStock !== undefined) push('opening_stock', round(patch.openingStock))
    if (patch.reorderLevel !== undefined) push('reorder_level', round(patch.reorderLevel))
    if (patch.netWeight !== undefined) push('net_weight', patch.netWeight)
    if (patch.grossWeight !== undefined) push('gross_weight', patch.grossWeight)
    if (patch.quantityPacked !== undefined) push('quantity_packed', patch.quantityPacked)
    if (patch.supplierId !== undefined) push('supplier_id', patch.supplierId)
    for (const key of ['packingBoxDetails', 'location', 'notes'] as const) {
      if (patch[key] !== undefined) {
        const column = key === 'packingBoxDetails' ? 'packing_box_details' : key
        const value = patch[key]?.toString().trim() || null
        ;(next as unknown as Record<string, unknown>)[key] = value
        push(column, value)
      }
    }
    if (!sets.length) return current

    push('search_blob', searchBlob(next))
    push('updated_at', Date.now())
    params.push(id)
    run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params)
    return itemsRepo.getPlain(id)
  },

  setArchived(id: string, archived: boolean): Item | null {
    run('UPDATE items SET archived_at = ?, updated_at = ? WHERE id = ?', [
      archived ? Date.now() : null,
      Date.now(),
      id
    ])
    return itemsRepo.getPlain(id)
  },

  /**
   * Refuses to delete anything the rest of the database still points at. Cascading
   * would take the item's whole ledger history with it, which is exactly the kind of
   * silent data loss a stock register must not have — archiving is the way out.
   */
  remove(id: string): { ok: boolean; error?: string } {
    const item = itemsRepo.getPlain(id)
    if (!item) return { ok: false, error: 'Item not found' }

    const moves = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stock_moves WHERE item_id = ?', [id])?.c ?? 0
    if (moves > 0) {
      return {
        ok: false,
        error: `${item.code} has ${moves} ledger ${moves === 1 ? 'entry' : 'entries'}. Archive it instead — deleting would erase that history.`
      }
    }
    const boms =
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM bom_lines WHERE fg_item_id = ? OR rm_item_id = ?', [id, id])
        ?.c ?? 0
    if (boms > 0) {
      return { ok: false, error: `${item.code} appears in ${boms} bill-of-materials ${boms === 1 ? 'line' : 'lines'}. Remove those first.` }
    }
    const orders = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM orders WHERE fg_item_id = ?', [id])?.c ?? 0
    if (orders > 0) {
      return { ok: false, error: `${item.code} is on ${orders} ${orders === 1 ? 'order' : 'orders'}. Archive it instead.` }
    }

    run('DELETE FROM items WHERE id = ?', [id])
    return { ok: true }
  },

  list(q: ItemQuery = {}): { items: ItemWithStock[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []

    const scope = q.scope ?? 'active'
    if (scope === 'active') where.push('i.archived_at IS NULL')
    else if (scope === 'archived') where.push('i.archived_at IS NOT NULL')

    if (q.search?.trim()) {
      // Every term must appear somewhere, so "rm bracket" narrows rather than widens.
      for (const term of q.search.trim().toLowerCase().split(/\s+/).slice(0, 6)) {
        where.push('i.search_blob LIKE ?')
        params.push(`%${term}%`)
      }
    }
    if (q.type && q.type !== 'all') {
      where.push('i.type = ?')
      params.push(q.type)
    }
    if (q.supplierIds?.length) {
      where.push(`i.supplier_id IN (${q.supplierIds.map(() => '?').join(',')})`)
      params.push(...q.supplierIds)
    }
    if (q.locations?.length) {
      where.push(`i.location IN (${q.locations.map(() => '?').join(',')})`)
      params.push(...q.locations)
    }

    // Stock conditions read off the views, so they stay in step with the ledger.
    const free = 'COALESCE(st.current_stock, i.opening_stock) - COALESCE(c.committed, 0)'
    switch (q.stockFilter) {
      case 'below_reorder':
        where.push(`i.reorder_level > 0 AND ${free} <= i.reorder_level`)
        break
      case 'negative':
        where.push('COALESCE(st.current_stock, i.opening_stock) < 0')
        break
      case 'zero':
        where.push('COALESCE(st.current_stock, i.opening_stock) = 0')
        break
      case 'in_stock':
        where.push('COALESCE(st.current_stock, i.opening_stock) > 0')
        break
      case 'no_reorder_level':
        where.push('i.reorder_level <= 0')
        break
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const orderSql = {
      code: 'i.code COLLATE NOCASE ASC',
      name: 'i.name COLLATE NOCASE ASC',
      stock_asc: `${free} ASC`,
      stock_desc: `${free} DESC`,
      // Most urgent first: how far below the reorder level the item has fallen.
      shortfall: `CASE WHEN i.reorder_level > 0 THEN i.reorder_level - ${free} ELSE -1e12 END DESC`,
      recent: 'i.updated_at DESC'
    }[q.sort ?? 'code']

    const total =
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c
           FROM items i
           LEFT JOIN item_stock st    ON st.item_id = i.id
           LEFT JOIN item_committed c ON c.item_id = i.id
           ${whereSql}`,
        params
      )?.c ?? 0

    const limit = Math.min(q.limit ?? 300, 2000)
    const offset = q.offset ?? 0

    const rows = query<StockRow>(`${SELECT_WITH_STOCK} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset
    ])

    return { total, items: rows.map(toItemWithStock) }
  },

  /** Distinct non-empty locations, for the filter dropdown. */
  locations(): string[] {
    return query<{ location: string }>(
      "SELECT DISTINCT location FROM items WHERE location IS NOT NULL AND location != '' ORDER BY location"
    ).map((r) => r.location)
  },

  /** Units already in use, so the item form can suggest rather than dictate. */
  units(): string[] {
    return query<{ unit: string }>("SELECT DISTINCT unit FROM items WHERE unit != '' ORDER BY unit").map((r) => r.unit)
  },

  /**
   * Every item's balance at an instant. Possible only because the ledger keeps
   * timestamps — the workbook's SUMIFS had no way to ask this question.
   */
  stockAsOf(at: number): { itemId: string; code: string; name: string; unit: string; stock: number }[] {
    return query<{ id: string; code: string; name: string; unit: string; stock: number | null }>(
      `SELECT i.id, i.code, i.name, i.unit,
              i.opening_stock + COALESCE((
                SELECT SUM(CASE WHEN m.direction = 'in' THEN m.qty ELSE -m.qty END)
                  FROM stock_moves m
                 WHERE m.item_id = i.id AND m.voided_at IS NULL AND m.moved_at <= ?
              ), 0) AS stock
         FROM items i
        WHERE i.archived_at IS NULL
        ORDER BY i.code COLLATE NOCASE ASC`,
      [at]
    ).map((r) => ({ itemId: r.id, code: r.code, name: r.name, unit: r.unit, stock: round(r.stock ?? 0) }))
  },

  /** 30 days of running balance for one item, used by the detail sparkline. */
  balanceHistory(id: string, days = 30): { date: string; balance: number }[] {
    const item = itemsRepo.getPlain(id)
    if (!item) return []
    const DAY = 86_400_000
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const from = startOfToday - (days - 1) * DAY

    // One query for the balance entering the window, then daily deltas on top, rather
    // than `days` separate running-total queries.
    const opening =
      queryOne<{ v: number | null }>(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN qty ELSE -qty END), 0) AS v
           FROM stock_moves WHERE item_id = ? AND voided_at IS NULL AND moved_at < ?`,
        [id, from]
      )?.v ?? 0

    const deltas = new Map<string, number>()
    for (const row of query<{ d: string; v: number }>(
      `SELECT date(moved_at / 1000, 'unixepoch', 'localtime') AS d,
              SUM(CASE WHEN direction = 'in' THEN qty ELSE -qty END) AS v
         FROM stock_moves
        WHERE item_id = ? AND voided_at IS NULL AND moved_at >= ?
        GROUP BY d`,
      [id, from]
    )) {
      deltas.set(row.d, row.v)
    }

    let balance = item.openingStock + opening
    const out: { date: string; balance: number }[] = []
    for (let i = 0; i < days; i++) {
      const date = new Date(from + i * DAY)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      balance += deltas.get(key) ?? 0
      out.push({ date: key, balance: round(balance) })
    }
    return out
  },

  count(type?: ItemType): number {
    if (type) {
      return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE archived_at IS NULL AND type = ?', [type])
        ?.c ?? 0
    }
    return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM items WHERE archived_at IS NULL')?.c ?? 0
  },

  /** Bulk lookup by code, for the importer and CSV paths. */
  mapByCodes(codes: string[]): Map<string, Item> {
    const map = new Map<string, Item>()
    if (!codes.length) return map
    // Chunked so a large workbook cannot blow past SQLite's variable limit.
    for (let i = 0; i < codes.length; i += 400) {
      const chunk = codes.slice(i, i + 400).map((c) => c.trim().toLowerCase())
      const rows = query<ItemRow>(
        `SELECT * FROM items WHERE lower(code) IN (${chunk.map(() => '?').join(',')})`,
        chunk
      )
      for (const row of rows) map.set(row.code.trim().toLowerCase(), toItem(row))
    }
    return map
  },

  exportAll(): ItemWithStock[] {
    return query<StockRow>(`${SELECT_WITH_STOCK} ORDER BY i.code COLLATE NOCASE ASC`).map(toItemWithStock)
  },

  /** Items nothing references and nothing has moved — likely import debris. */
  orphans(): ItemWithStock[] {
    return query<StockRow>(
      `${SELECT_WITH_STOCK}
        WHERE i.archived_at IS NULL
          AND st.last_moved_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM bom_lines b WHERE b.rm_item_id = i.id OR b.fg_item_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.fg_item_id = i.id)
        ORDER BY i.code COLLATE NOCASE ASC`
    ).map(toItemWithStock)
  },

  transaction
}
