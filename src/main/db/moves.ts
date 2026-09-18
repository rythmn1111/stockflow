import type { MoveDirection, MoveQuery, MoveReason, StockMove, StockMoveWithItem } from '@shared/types'
import type { MoveInput } from '@shared/api'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { gt, round } from '../lib/num'
import { settingsRepo } from './settings'
import { plansRepo } from './plans'

interface MoveRow {
  id: string
  moved_at: number
  direction: string
  item_id: string
  qty: number
  reason: string
  reference_no: string | null
  order_id: string | null
  remarks: string | null
  voided_at: number | null
  voided_reason: string | null
  created_at: number
}

type JoinRow = MoveRow & {
  item_code: string
  item_name: string
  item_unit: string
  order_no: string | null
}

function toMove(r: MoveRow): StockMove {
  return {
    id: r.id,
    movedAt: r.moved_at,
    direction: r.direction as MoveDirection,
    itemId: r.item_id,
    qty: r.qty,
    reason: r.reason as MoveReason,
    referenceNo: r.reference_no,
    orderId: r.order_id,
    remarks: r.remarks,
    voidedAt: r.voided_at,
    voidedReason: r.voided_reason,
    createdAt: r.created_at
  }
}

function toMoveWithItem(r: JoinRow): StockMoveWithItem {
  return {
    ...toMove(r),
    itemCode: r.item_code,
    itemName: r.item_name,
    itemUnit: r.item_unit,
    orderNo: r.order_no
  }
}

const JOIN_SQL = `
  SELECT m.*,
         i.code AS item_code, i.name AS item_name, i.unit AS item_unit,
         o.order_no AS order_no
    FROM stock_moves m
    JOIN items i       ON i.id = m.item_id
    LEFT JOIN orders o ON o.id = m.order_id`

export interface CreateMoveOutcome {
  ok: boolean
  move: StockMoveWithItem | null
  error?: string
  /** Non-blocking note, e.g. the move took the item below zero and that is allowed. */
  warning?: string
}

export const movesRepo = {
  get(id: string): StockMove | null {
    const row = queryOne<MoveRow>('SELECT * FROM stock_moves WHERE id = ?', [id])
    return row ? toMove(row) : null
  },

  getWithItem(id: string): StockMoveWithItem | null {
    const row = queryOne<JoinRow>(`${JOIN_SQL} WHERE m.id = ?`, [id])
    return row ? toMoveWithItem(row) : null
  },

  /** Live stock for one item, straight off the view. */
  stockFor(itemId: string): number {
    const row = queryOne<{ current_stock: number | null }>('SELECT current_stock FROM item_stock WHERE item_id = ?', [
      itemId
    ])
    return round(row?.current_stock ?? 0)
  },

  /**
   * Appends to the ledger. The workbook accepted anything typed into `Material_Log`:
   * an item code with a typo became a row that silently affected nothing, a negative
   * quantity inverted the arithmetic, and going below zero passed without comment.
   * All three are caught here.
   */
  create(input: MoveInput): CreateMoveOutcome {
    const qty = round(input.qty)
    if (!(qty > 0)) {
      return { ok: false, move: null, error: 'Quantity must be greater than zero. Use the other direction instead of a negative number.' }
    }
    if (input.direction !== 'in' && input.direction !== 'out') {
      return { ok: false, move: null, error: 'Direction must be either inward or outward' }
    }

    const item = queryOne<{ id: string; code: string; name: string }>('SELECT id, code, name FROM items WHERE id = ?', [
      input.itemId
    ])
    if (!item) return { ok: false, move: null, error: 'That item is not in the item master' }

    if (input.orderId) {
      const order = queryOne<{ id: string }>('SELECT id FROM orders WHERE id = ?', [input.orderId])
      if (!order) return { ok: false, move: null, error: 'That order no longer exists' }
    }

    let warning: string | undefined
    if (input.direction === 'out') {
      const settings = settingsRepo.getAll()
      const current = movesRepo.stockFor(input.itemId)
      const after = round(current - qty)
      if (after < 0) {
        if (settings.blockNegativeStock) {
          return {
            ok: false,
            move: null,
            error: `${item.code} has ${current} in stock — issuing ${qty} would leave ${after}. Receive stock first, or turn off "block negative stock" in Settings.`
          }
        }
        warning = `${item.code} is now at ${after}. Negative stock usually means a receipt was never logged.`
      }
    }

    const id = ids.move()
    const now = Date.now()
    run(
      `INSERT INTO stock_moves (id, moved_at, direction, item_id, qty, reason, reference_no, order_id, remarks, voided_at, voided_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        id,
        input.movedAt ?? now,
        input.direction,
        input.itemId,
        qty,
        input.reason ?? (input.direction === 'in' ? 'purchase' : 'issue'),
        input.referenceNo?.trim() || null,
        input.orderId ?? null,
        input.remarks?.trim() || null,
        now
      ]
    )
    // The ledger is the only truth, so anything derived from it follows immediately.
    // Leaving this to the caller made `already_issued` — and therefore every free-stock
    // figure — silently stale whenever a move was written from a new code path.
    if (input.orderId) plansRepo.refreshIssued(input.orderId)

    return { ok: true, move: movesRepo.getWithItem(id), warning }
  },

  /** All-or-nothing batch. Used by issue-to-order and the CSV importer. */
  createMany(inputs: MoveInput[]): { ok: boolean; created: number; error?: string } {
    if (!inputs.length) return { ok: true, created: 0 }
    try {
      return transaction(() => {
        let created = 0
        for (const input of inputs) {
          const result = movesRepo.create(input)
          if (!result.ok) throw new Error(result.error ?? 'A ledger entry was rejected')
          created++
        }
        return { ok: true, created }
      })
    } catch (err) {
      return { ok: false, created: 0, error: err instanceof Error ? err.message : String(err) }
    }
  },

  /**
   * Voids rather than deletes. A stock register whose history can be edited away is
   * not a register, so a mistake is struck through with a reason and stays visible.
   */
  void(id: string, reason: string): { ok: boolean; error?: string } {
    const move = movesRepo.get(id)
    if (!move) return { ok: false, error: 'Ledger entry not found' }
    if (move.voidedAt) return { ok: false, error: 'That entry is already voided' }
    const trimmed = reason.trim()
    if (!trimmed) return { ok: false, error: 'Give a reason so the ledger explains itself later' }

    run('UPDATE stock_moves SET voided_at = ?, voided_reason = ? WHERE id = ?', [Date.now(), trimmed.slice(0, 500), id])
    // Voiding an issue returns the material, so the plan's issued figure comes back down.
    if (move.orderId) plansRepo.refreshIssued(move.orderId)
    return { ok: true }
  },

  list(q: MoveQuery = {}): { items: StockMoveWithItem[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []

    if (!q.includeVoided) where.push('m.voided_at IS NULL')
    if (q.itemId) {
      where.push('m.item_id = ?')
      params.push(q.itemId)
    }
    if (q.orderId) {
      where.push('m.order_id = ?')
      params.push(q.orderId)
    }
    if (q.direction && q.direction !== 'all') {
      where.push('m.direction = ?')
      params.push(q.direction)
    }
    if (q.reasons?.length) {
      where.push(`m.reason IN (${q.reasons.map(() => '?').join(',')})`)
      params.push(...q.reasons)
    }
    if (q.from != null) {
      where.push('m.moved_at >= ?')
      params.push(q.from)
    }
    if (q.to != null) {
      where.push('m.moved_at <= ?')
      params.push(q.to)
    }
    if (q.search?.trim()) {
      const term = `%${q.search.trim().toLowerCase()}%`
      where.push(
        `(lower(i.code) LIKE ? OR lower(i.name) LIKE ? OR lower(coalesce(m.reference_no,'')) LIKE ?
          OR lower(coalesce(m.remarks,'')) LIKE ? OR lower(coalesce(o.order_no,'')) LIKE ?)`
      )
      params.push(term, term, term, term, term)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total =
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM stock_moves m
           JOIN items i ON i.id = m.item_id
           LEFT JOIN orders o ON o.id = m.order_id
           ${whereSql}`,
        params
      )?.c ?? 0

    const limit = Math.min(q.limit ?? 200, 2000)
    const offset = q.offset ?? 0
    const rows = query<JoinRow>(
      `${JOIN_SQL} ${whereSql} ORDER BY m.moved_at DESC, m.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    return { total, items: rows.map(toMoveWithItem) }
  },

  forItem(itemId: string, limit = 50): StockMoveWithItem[] {
    return query<JoinRow>(
      `${JOIN_SQL} WHERE m.item_id = ? ORDER BY m.moved_at DESC, m.created_at DESC LIMIT ?`,
      [itemId, limit]
    ).map(toMoveWithItem)
  },

  forOrder(orderId: string): StockMoveWithItem[] {
    return query<JoinRow>(`${JOIN_SQL} WHERE m.order_id = ? ORDER BY m.moved_at DESC`, [orderId]).map(toMoveWithItem)
  },

  /** How much of one item has been issued to one order — makes re-planning idempotent. */
  issuedToOrder(itemId: string, orderId: string): number {
    const row = queryOne<{ v: number | null }>(
      `SELECT COALESCE(SUM(qty), 0) AS v FROM stock_moves
        WHERE item_id = ? AND order_id = ? AND direction = 'out' AND voided_at IS NULL`,
      [itemId, orderId]
    )
    return round(row?.v ?? 0)
  },

  /** Finished units booked into stock against one order. */
  producedForOrder(orderId: string): number {
    const row = queryOne<{ v: number | null }>(
      `SELECT COALESCE(SUM(qty), 0) AS v FROM stock_moves
        WHERE order_id = ? AND direction = 'in' AND reason = 'production' AND voided_at IS NULL`,
      [orderId]
    )
    return round(row?.v ?? 0)
  },

  countSince(sinceMs: number): number {
    return (
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stock_moves WHERE voided_at IS NULL AND moved_at >= ?', [
        sinceMs
      ])?.c ?? 0
    )
  },

  /** 14-day inward/outward line counts for the dashboard chart. */
  activityByDay(days = 14): { date: string; inward: number; outward: number }[] {
    const DAY = 86_400_000
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const from = startOfToday - (days - 1) * DAY

    const rows = query<{ d: string; direction: string; c: number }>(
      `SELECT date(moved_at / 1000, 'unixepoch', 'localtime') AS d, direction, COUNT(*) AS c
         FROM stock_moves
        WHERE voided_at IS NULL AND moved_at >= ?
        GROUP BY d, direction`,
      [from]
    )
    const byDay = new Map<string, { inward: number; outward: number }>()
    for (const row of rows) {
      const entry = byDay.get(row.d) ?? { inward: 0, outward: 0 }
      if (row.direction === 'in') entry.inward = row.c
      else entry.outward = row.c
      byDay.set(row.d, entry)
    }

    const out: { date: string; inward: number; outward: number }[] = []
    for (let i = 0; i < days; i++) {
      const date = new Date(from + i * DAY)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const entry = byDay.get(key) ?? { inward: 0, outward: 0 }
      out.push({ date: key, ...entry })
    }
    return out
  },

  /** Items the ledger has driven below zero — a real-world impossibility worth flagging. */
  negativeStockCount(): number {
    return queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM item_stock st JOIN items i ON i.id = st.item_id
        WHERE i.archived_at IS NULL AND st.current_stock < 0`
    )?.c ?? 0
  },

  exportRows(q: MoveQuery = {}): StockMoveWithItem[] {
    return movesRepo.list({ ...q, limit: 2000 }).items
  },

  /** Exposed so callers can check a would-be issue without writing anything. */
  wouldGoNegative(itemId: string, qty: number): boolean {
    return gt(qty, movesRepo.stockFor(itemId))
  }
}
