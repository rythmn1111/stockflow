import type { ItemType, Plan, PlanLine, PlanLineWithItems, PlanWithLines } from '@shared/types'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'
import { ordersRepo } from './orders'

interface PlanRow {
  id: string
  order_id: string
  note: string | null
  total_shortage: number
  line_count: number
  superseded_at: number | null
  created_at: number
}

interface PlanLineRow {
  id: string
  plan_id: string
  rm_item_id: string
  qty_required: number
  stock_available: number
  shortage: number
  already_issued: number
  depth: number
  supplier_id: string | null
}

type PlanLineJoinRow = PlanLineRow & {
  rm_code: string
  rm_name: string
  rm_unit: string
  rm_type: string
  supplier_name: string | null
  supplier_contact: string | null
  supplier_phone: string | null
  supplier_lead_time_days: number | null
  current_stock: number | null
  committed: number | null
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    orderId: r.order_id,
    note: r.note,
    totalShortage: round(r.total_shortage),
    lineCount: r.line_count,
    supersededAt: r.superseded_at,
    createdAt: r.created_at
  }
}

function toPlanLine(r: PlanLineRow): PlanLine {
  return {
    id: r.id,
    planId: r.plan_id,
    rmItemId: r.rm_item_id,
    qtyRequired: round(r.qty_required),
    stockAvailable: round(r.stock_available),
    shortage: round(r.shortage),
    alreadyIssued: round(r.already_issued),
    depth: r.depth,
    supplierId: r.supplier_id
  }
}

function toPlanLineWithItems(r: PlanLineJoinRow): PlanLineWithItems {
  return {
    ...toPlanLine(r),
    rmCode: r.rm_code,
    rmName: r.rm_name,
    rmUnit: r.rm_unit,
    rmType: r.rm_type as ItemType,
    supplierName: r.supplier_name,
    supplierContact: r.supplier_contact,
    supplierPhone: r.supplier_phone,
    supplierLeadTimeDays: r.supplier_lead_time_days,
    currentFreeStock: round((r.current_stock ?? 0) - (r.committed ?? 0))
  }
}

const LINE_JOIN_SQL = `
  SELECT pl.*,
         rm.code AS rm_code, rm.name AS rm_name, rm.unit AS rm_unit, rm.type AS rm_type,
         s.name AS supplier_name, s.contact AS supplier_contact, s.phone AS supplier_phone,
         s.lead_time_days AS supplier_lead_time_days,
         st.current_stock, c.committed
    FROM plan_lines pl
    JOIN items rm              ON rm.id = pl.rm_item_id
    LEFT JOIN suppliers s      ON s.id = pl.supplier_id
    LEFT JOIN item_stock st    ON st.item_id = pl.rm_item_id
    LEFT JOIN item_committed c ON c.item_id = pl.rm_item_id`

export interface NewPlanLine {
  rmItemId: string
  qtyRequired: number
  stockAvailable: number
  shortage: number
  alreadyIssued: number
  depth: number
  supplierId: string | null
}

export const plansRepo = {
  get(id: string): Plan | null {
    const row = queryOne<PlanRow>('SELECT * FROM plans WHERE id = ?', [id])
    return row ? toPlan(row) : null
  },

  /** The live plan for an order, or null when it has never been planned. */
  liveFor(orderId: string): Plan | null {
    const row = queryOne<PlanRow>('SELECT * FROM plans WHERE order_id = ? AND superseded_at IS NULL', [orderId])
    return row ? toPlan(row) : null
  },

  lines(planId: string): PlanLineWithItems[] {
    return query<PlanLineJoinRow>(
      `${LINE_JOIN_SQL} WHERE pl.plan_id = ? ORDER BY pl.depth ASC, rm.code COLLATE NOCASE ASC`,
      [planId]
    ).map(toPlanLineWithItems)
  },

  withLines(planId: string): PlanWithLines | null {
    const plan = plansRepo.get(planId)
    if (!plan) return null
    const order = ordersRepo.get(plan.orderId)
    if (!order) return null
    return { ...plan, order, lines: plansRepo.lines(planId) }
  },

  liveWithLines(orderId: string): PlanWithLines | null {
    const plan = plansRepo.liveFor(orderId)
    return plan ? plansRepo.withLines(plan.id) : null
  },

  /**
   * Saves a freshly computed plan and retires the previous one.
   *
   * The workbook's macro cleared the whole planning sheet before writing, so only one
   * order could be planned at a time and the previous answer was simply gone. Here the
   * old plan is marked superseded instead: it stops committing stock, but it stays
   * readable, which makes "what did we think we needed last week?" answerable.
   */
  replaceFor(orderId: string, lines: NewPlanLine[], note?: string | null): Plan {
    return transaction(() => {
      const now = Date.now()
      run('UPDATE plans SET superseded_at = ? WHERE order_id = ? AND superseded_at IS NULL', [now, orderId])

      const planId = ids.plan()
      const totalShortage = round(lines.reduce((sum, line) => sum + line.shortage, 0))
      run(
        `INSERT INTO plans (id, order_id, note, total_shortage, line_count, superseded_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
        [planId, orderId, note?.trim() || null, totalShortage, lines.length, now]
      )

      for (const line of lines) {
        run(
          `INSERT INTO plan_lines (id, plan_id, rm_item_id, qty_required, stock_available, shortage, already_issued, depth, supplier_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ids.planLine(),
            planId,
            line.rmItemId,
            round(line.qtyRequired),
            round(line.stockAvailable),
            round(line.shortage),
            round(line.alreadyIssued),
            line.depth,
            line.supplierId
          ]
        )
      }

      return plansRepo.get(planId)!
    })
  },

  /** Every plan ever run for an order, newest first. */
  historyFor(orderId: string): PlanWithLines[] {
    const rows = query<PlanRow>('SELECT * FROM plans WHERE order_id = ? ORDER BY created_at DESC LIMIT 25', [orderId])
    const order = ordersRepo.get(orderId)
    if (!order) return []
    return rows.map((row) => ({ ...toPlan(row), order, lines: plansRepo.lines(row.id) }))
  },

  /**
   * Re-reads `already_issued` from the ledger for the live plan. Called after material
   * is issued so the plan's commitment shrinks by what actually left the store —
   * without this, issuing stock would not free up the reservation it satisfies.
   */
  refreshIssued(orderId: string): void {
    const plan = plansRepo.liveFor(orderId)
    if (!plan) return
    run(
      `UPDATE plan_lines
          SET already_issued = COALESCE((
                SELECT SUM(m.qty) FROM stock_moves m
                 WHERE m.item_id = plan_lines.rm_item_id
                   AND m.order_id = ?
                   AND m.direction = 'out'
                   AND m.voided_at IS NULL
              ), 0)
        WHERE plan_id = ?`,
      [orderId, plan.id]
    )
    // Shortage is recomputed against live free stock so the plan stays honest between
    // full re-plans; `already_issued` no longer needs buying.
    run(
      `UPDATE plan_lines
          SET shortage = MAX(
                qty_required - already_issued - COALESCE((
                  SELECT st.current_stock FROM item_stock st WHERE st.item_id = plan_lines.rm_item_id
                ), 0), 0)
        WHERE plan_id = ?`,
      [plan.id]
    )
    run(
      `UPDATE plans SET total_shortage = COALESCE((SELECT SUM(shortage) FROM plan_lines WHERE plan_id = ?), 0)
        WHERE id = ?`,
      [plan.id, plan.id]
    )
  },

  /** Lines on live plans for open orders that are still short — drives purchasing. */
  openShortageLines(): {
    itemId: string
    code: string
    name: string
    unit: string
    shortage: number
    supplierId: string | null
    supplierName: string | null
    supplierContact: string | null
    supplierPhone: string | null
    leadTimeDays: number | null
    orderId: string
    orderNo: string
    dueDate: number | null
  }[] {
    return query<{
      item_id: string
      code: string
      name: string
      unit: string
      shortage: number
      supplier_id: string | null
      supplier_name: string | null
      supplier_contact: string | null
      supplier_phone: string | null
      lead_time_days: number | null
      order_id: string
      order_no: string
      due_date: number | null
    }>(
      `SELECT pl.rm_item_id AS item_id, rm.code, rm.name, rm.unit, pl.shortage,
              rmsup.supplier_id, s.name AS supplier_name, s.contact AS supplier_contact,
              s.phone AS supplier_phone,
              COALESCE(rmsup.lead_time_days, s.lead_time_days) AS lead_time_days,
              o.id AS order_id, o.order_no, o.due_date
         FROM plan_lines pl
         JOIN plans p          ON p.id = pl.plan_id AND p.superseded_at IS NULL
         JOIN orders o         ON o.id = p.order_id
         JOIN items rm         ON rm.id = pl.rm_item_id
         LEFT JOIN item_suppliers rmsup ON rmsup.item_id = rm.id AND rmsup.is_preferred = 1
         LEFT JOIN suppliers s          ON s.id = rmsup.supplier_id
        WHERE o.status IN ('draft','planned','in_production')
          AND pl.shortage > 0
        ORDER BY s.name COLLATE NOCASE ASC, rm.code COLLATE NOCASE ASC`
    ).map((r) => ({
      itemId: r.item_id,
      code: r.code,
      name: r.name,
      unit: r.unit,
      shortage: round(r.shortage),
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierContact: r.supplier_contact,
      supplierPhone: r.supplier_phone,
      leadTimeDays: r.lead_time_days,
      orderId: r.order_id,
      orderNo: r.order_no,
      dueDate: r.due_date
    }))
  },

  /** Orders whose live plan still has at least one short line. */
  ordersWithShortage(): number {
    return (
      queryOne<{ c: number }>(
        `SELECT COUNT(DISTINCT p.order_id) AS c
           FROM plans p
           JOIN plan_lines pl ON pl.plan_id = p.id
           JOIN orders o      ON o.id = p.order_id
          WHERE p.superseded_at IS NULL
            AND o.status IN ('draft','planned','in_production')
            AND pl.shortage > 0`
      )?.c ?? 0
    )
  },

  totalShortageLines(): number {
    return (
      queryOne<{ c: number }>(
        `SELECT COUNT(*) AS c
           FROM plan_lines pl
           JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
           JOIN orders o ON o.id = p.order_id
          WHERE o.status IN ('draft','planned','in_production') AND pl.shortage > 0`
      )?.c ?? 0
    )
  },

  /** Biggest shortages across every live plan, for the dashboard. */
  topShortages(limit = 8): { code: string; name: string; unit: string; shortage: number; orderNo: string }[] {
    return query<{ code: string; name: string; unit: string; shortage: number; order_no: string }>(
      `SELECT rm.code, rm.name, rm.unit, pl.shortage, o.order_no
         FROM plan_lines pl
         JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
         JOIN orders o ON o.id = p.order_id
         JOIN items rm ON rm.id = pl.rm_item_id
        WHERE o.status IN ('draft','planned','in_production') AND pl.shortage > 0
        ORDER BY pl.shortage DESC
        LIMIT ?`,
      [limit]
    ).map((r) => ({ code: r.code, name: r.name, unit: r.unit, shortage: round(r.shortage), orderNo: r.order_no }))
  }
}
