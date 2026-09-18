import type { Order, OrderQuery, OrderStatus, OrderWithItem } from '@shared/types'
import type { OrderInput } from '@shared/api'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'

interface OrderRow {
  id: string
  order_no: string
  order_date: number
  fg_item_id: string
  qty_ordered: number
  status: string
  customer: string | null
  due_date: number | null
  notes: string | null
  created_at: number
  updated_at: number
}

type JoinRow = OrderRow & {
  fg_code: string
  fg_name: string
  fg_unit: string
  latest_plan_id: string | null
  latest_plan_at: number | null
  shortage_lines: number | null
  issued_lines: number | null
  produced_qty: number | null
}

/** Statuses that still consume stock; a cancelled or completed order commits nothing. */
export const OPEN_STATUSES: OrderStatus[] = ['draft', 'planned', 'in_production']

function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    orderNo: r.order_no,
    orderDate: r.order_date,
    fgItemId: r.fg_item_id,
    qtyOrdered: r.qty_ordered,
    status: r.status as OrderStatus,
    customer: r.customer,
    dueDate: r.due_date,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function toOrderWithItem(r: JoinRow): OrderWithItem {
  return {
    ...toOrder(r),
    fgCode: r.fg_code,
    fgName: r.fg_name,
    fgUnit: r.fg_unit,
    latestPlanId: r.latest_plan_id,
    latestPlanAt: r.latest_plan_at,
    shortageLines: r.shortage_lines ?? 0,
    issuedLines: r.issued_lines ?? 0,
    producedQty: round(r.produced_qty ?? 0)
  }
}

/**
 * An order plus the three things every order screen asks about: which plan is live,
 * how much of it is still short, and what has actually been issued or produced.
 */
const JOIN_SQL = `
  SELECT o.*,
         fg.code AS fg_code, fg.name AS fg_name, fg.unit AS fg_unit,
         p.id AS latest_plan_id, p.created_at AS latest_plan_at,
         (SELECT COUNT(*) FROM plan_lines pl WHERE pl.plan_id = p.id AND pl.shortage > 0) AS shortage_lines,
         (SELECT COUNT(DISTINCT m.item_id) FROM stock_moves m
           WHERE m.order_id = o.id AND m.direction = 'out' AND m.voided_at IS NULL) AS issued_lines,
         (SELECT COALESCE(SUM(m.qty), 0) FROM stock_moves m
           WHERE m.order_id = o.id AND m.direction = 'in' AND m.reason = 'production' AND m.voided_at IS NULL) AS produced_qty
    FROM orders o
    JOIN items fg  ON fg.id = o.fg_item_id
    LEFT JOIN plans p ON p.order_id = o.id AND p.superseded_at IS NULL`

export const ordersRepo = {
  get(id: string): OrderWithItem | null {
    const row = queryOne<JoinRow>(`${JOIN_SQL} WHERE o.id = ?`, [id])
    return row ? toOrderWithItem(row) : null
  },

  getPlain(id: string): Order | null {
    const row = queryOne<OrderRow>('SELECT * FROM orders WHERE id = ?', [id])
    return row ? toOrder(row) : null
  },

  byNo(orderNo: string): Order | null {
    const row = queryOne<OrderRow>('SELECT * FROM orders WHERE lower(order_no) = ?', [orderNo.trim().toLowerCase()])
    return row ? toOrder(row) : null
  },

  create(input: OrderInput): { order: Order; duplicate: boolean } {
    const orderNo = input.orderNo.trim()
    if (!orderNo) throw new Error('An order number is required')
    if (!(input.qtyOrdered > 0)) throw new Error('Order quantity must be greater than zero')

    const existing = ordersRepo.byNo(orderNo)
    if (existing) return { order: existing, duplicate: true }

    const item = queryOne<{ id: string; type: string }>('SELECT id, type FROM items WHERE id = ?', [input.fgItemId])
    if (!item) throw new Error('That finished good is not in the item master')

    const now = Date.now()
    const id = ids.order()
    run(
      `INSERT INTO orders (id, order_no, order_date, fg_item_id, qty_ordered, status, customer, due_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        orderNo,
        input.orderDate,
        input.fgItemId,
        round(input.qtyOrdered),
        input.status ?? 'draft',
        input.customer?.trim() || null,
        input.dueDate ?? null,
        input.notes?.trim() || null,
        now,
        now
      ]
    )
    return { order: ordersRepo.getPlain(id)!, duplicate: false }
  },

  update(id: string, patch: Partial<OrderInput>): Order | null {
    const current = ordersRepo.getPlain(id)
    if (!current) return null

    const sets: string[] = []
    const params: unknown[] = []
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      params.push(value)
    }

    if (patch.orderNo !== undefined) {
      const orderNo = patch.orderNo.trim()
      if (!orderNo) throw new Error('An order number is required')
      const clash = ordersRepo.byNo(orderNo)
      if (clash && clash.id !== id) throw new Error(`Order ${orderNo} already exists`)
      push('order_no', orderNo)
    }
    if (patch.orderDate !== undefined) push('order_date', patch.orderDate)
    if (patch.fgItemId !== undefined) push('fg_item_id', patch.fgItemId)
    if (patch.qtyOrdered !== undefined) {
      if (!(patch.qtyOrdered > 0)) throw new Error('Order quantity must be greater than zero')
      push('qty_ordered', round(patch.qtyOrdered))
    }
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.dueDate !== undefined) push('due_date', patch.dueDate)
    for (const key of ['customer', 'notes'] as const) {
      if (patch[key] !== undefined) push(key, patch[key]?.toString().trim() || null)
    }
    if (!sets.length) return current

    return transaction(() => {
      push('updated_at', Date.now())
      params.push(id)
      run(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params)

      // The quantity or the product changed, so the saved plan no longer describes
      // this order. Superseding it releases its commitment rather than leaving stock
      // reserved against numbers that no longer exist.
      const materialChange =
        (patch.qtyOrdered !== undefined && patch.qtyOrdered !== current.qtyOrdered) ||
        (patch.fgItemId !== undefined && patch.fgItemId !== current.fgItemId)
      if (materialChange) {
        run('UPDATE plans SET superseded_at = ? WHERE order_id = ? AND superseded_at IS NULL', [Date.now(), id])
      }
      return ordersRepo.getPlain(id)
    })
  },

  setStatus(id: string, status: OrderStatus): Order | null {
    run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id])
    return ordersRepo.getPlain(id)
  },

  /** Refuses while the ledger still points at the order, so history cannot vanish. */
  remove(id: string): { ok: boolean; error?: string } {
    const order = ordersRepo.getPlain(id)
    if (!order) return { ok: false, error: 'Order not found' }

    const moves =
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM stock_moves WHERE order_id = ? AND voided_at IS NULL', [id])
        ?.c ?? 0
    if (moves > 0) {
      return {
        ok: false,
        error: `Order ${order.orderNo} has ${moves} ledger ${moves === 1 ? 'entry' : 'entries'} against it. Cancel the order instead — deleting would detach that history.`
      }
    }
    // Plans cascade; they are derived data and carry no history of their own.
    run('DELETE FROM orders WHERE id = ?', [id])
    return { ok: true }
  },

  list(q: OrderQuery = {}): { items: OrderWithItem[]; total: number } {
    const where: string[] = []
    const params: unknown[] = []

    if (q.statuses?.length) {
      where.push(`o.status IN (${q.statuses.map(() => '?').join(',')})`)
      params.push(...q.statuses)
    }
    if (q.search?.trim()) {
      const term = `%${q.search.trim().toLowerCase()}%`
      where.push(
        `(lower(o.order_no) LIKE ? OR lower(coalesce(o.customer,'')) LIKE ? OR lower(fg.code) LIKE ? OR lower(fg.name) LIKE ?)`
      )
      params.push(term, term, term, term)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const orderSql = {
      recent: 'o.order_date DESC, o.created_at DESC',
      // Numeric-aware so order 9 sorts before order 10, which plain text would not do.
      order_no: 'CAST(o.order_no AS INTEGER) DESC, o.order_no DESC',
      due: 'CASE WHEN o.due_date IS NULL THEN 1 ELSE 0 END ASC, o.due_date ASC',
      shortage: 'shortage_lines DESC, o.order_date DESC'
    }[q.sort ?? 'recent']

    const total =
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM orders o JOIN items fg ON fg.id = o.fg_item_id ${whereSql}`,
        params
      )?.c ?? 0

    const limit = Math.min(q.limit ?? 200, 1000)
    const offset = q.offset ?? 0
    const rows = query<JoinRow>(`${JOIN_SQL} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset
    ])

    return { total, items: rows.map(toOrderWithItem) }
  },

  /** Open orders holding a commitment against one item, for the item detail page. */
  commitmentsFor(itemId: string): { orderId: string; orderNo: string; qty: number; dueDate: number | null }[] {
    return query<{ order_id: string; order_no: string; qty: number; due_date: number | null }>(
      `SELECT o.id AS order_id, o.order_no, MAX(pl.qty_required - pl.already_issued, 0) AS qty, o.due_date
         FROM plan_lines pl
         JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
         JOIN orders o ON o.id = p.order_id
        WHERE pl.rm_item_id = ?
          AND o.status IN ('draft','planned','in_production')
          AND pl.qty_required - pl.already_issued > 0
        ORDER BY CASE WHEN o.due_date IS NULL THEN 1 ELSE 0 END ASC, o.due_date ASC`,
      [itemId]
    ).map((r) => ({ orderId: r.order_id, orderNo: r.order_no, qty: round(r.qty), dueDate: r.due_date }))
  },

  openCount(): number {
    return (
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM orders WHERE status IN ('draft','planned','in_production')`
      )?.c ?? 0
    )
  },

  count(): number {
    return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM orders')?.c ?? 0
  },

  exportAll(): OrderWithItem[] {
    return query<JoinRow>(`${JOIN_SQL} ORDER BY o.order_date DESC`).map(toOrderWithItem)
  }
}
