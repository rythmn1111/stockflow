import type { PlanWithLines, PurchaseSuggestion } from '@shared/types'
import type { IssueResult } from '@shared/api'
import { bomRepo } from '../db/bom'
import { itemsRepo } from '../db/items'
import { movesRepo } from '../db/moves'
import { ordersRepo } from '../db/orders'
import { plansRepo, type NewPlanLine } from '../db/plans'
import { queryOne, transaction } from '../db/connection'
import { atLeastZero, gt, round } from '../lib/num'
import { log } from '../lib/log'

const DAY = 86_400_000

/**
 * Material planning — the app's version of the workbook's `ProcessOrder` macro.
 *
 * The macro did: for the selected order row, walk one level of BOM, multiply by the
 * order quantity, VLOOKUP `Current_Stock`, and write `MAX(0, required - available)`.
 * It cleared the entire planning sheet first, so only one order could be planned.
 *
 * Four things are different here, and each one closes a hole:
 *
 *  1. The explosion is recursive, so sub-assemblies are followed and scrap allowances
 *     are applied.
 *  2. Availability is *free* stock — on hand minus what other open orders have already
 *     been promised. Two orders can no longer both plan against the same part.
 *  3. Material already issued to this order is subtracted from the requirement, so
 *     re-planning a part-issued order does not ask for everything twice.
 *  4. The result is saved against the order rather than overwriting a shared sheet.
 */
export function planOrder(orderId: string): { ok: boolean; plan: PlanWithLines | null; error?: string } {
  const order = ordersRepo.get(orderId)
  if (!order) return { ok: false, plan: null, error: 'Order not found' }
  if (order.status === 'cancelled') return { ok: false, plan: null, error: 'This order is cancelled' }
  if (!(order.qtyOrdered > 0)) return { ok: false, plan: null, error: 'Order quantity must be greater than zero' }

  const { lines: exploded, cycle } = bomRepo.explode(order.fgItemId, order.qtyOrdered)
  if (cycle) {
    return {
      ok: false,
      plan: null,
      error: `${order.fgCode} has a loop in its bill of materials: ${cycle.join(' → ')}. Fix that before planning.`
    }
  }
  if (!exploded.length) {
    return {
      ok: false,
      plan: null,
      error: `${order.fgCode} has no bill of materials yet. Add its components on the BOM page, then plan again.`
    }
  }

  return transaction(() => {
    const planLines: NewPlanLine[] = exploded.map((line) => {
      // Free stock, not current stock: exclude this order's own live plan so
      // re-planning does not count its own reservation against itself.
      const free = freeStockExcludingOrder(line.itemId, orderId)
      const alreadyIssued = movesRepo.issuedToOrder(line.itemId, orderId)
      const outstanding = atLeastZero(line.qty - alreadyIssued)
      const shortage = atLeastZero(outstanding - free)
      const item = itemsRepo.getPlain(line.itemId)

      return {
        rmItemId: line.itemId,
        qtyRequired: round(line.qty),
        stockAvailable: round(free),
        shortage,
        alreadyIssued,
        depth: line.depth,
        supplierId: item?.supplierId ?? null
      }
    })

    const plan = plansRepo.replaceFor(orderId, planLines)

    // A planned order is no longer a draft. Left alone once it is further along, so
    // planning an in-production order does not walk its status backwards.
    if (order.status === 'draft') ordersRepo.setStatus(orderId, 'planned')

    const short = planLines.filter((line) => line.shortage > 0).length
    log.info(
      'planning',
      `planned ${order.orderNo} (${order.fgCode} × ${order.qtyOrdered}): ${planLines.length} component(s), ${short} short`
    )

    return { ok: true, plan: plansRepo.withLines(plan.id), error: undefined }
  })
}

/**
 * On-hand stock minus commitments from *other* open orders.
 *
 * Excluding the order being planned is the subtle part: its own live plan is about to
 * be replaced, so counting its reservation would make every re-plan look progressively
 * shorter than the one before.
 */
function freeStockExcludingOrder(itemId: string, orderId: string): number {
  const current = movesRepo.stockFor(itemId)
  const committedElsewhere =
    queryOne<{ v: number | null }>(
      `SELECT COALESCE(SUM(MAX(pl.qty_required - pl.already_issued, 0)), 0) AS v
         FROM plan_lines pl
         JOIN plans p  ON p.id = pl.plan_id AND p.superseded_at IS NULL
         JOIN orders o ON o.id = p.order_id
        WHERE pl.rm_item_id = ?
          AND o.id != ?
          AND o.status IN ('draft','planned','in_production')`,
      [itemId, orderId]
    )?.v ?? 0

  return round(current - committedElsewhere)
}

/**
 * Turns a plan into ledger entries: one OUTWARD move per component, for as much as
 * stock can currently cover.
 *
 * In the workbook this was nine rows typed into `Material_Log` by hand, with the order
 * number remembered in the Remarks column. Partial issue is deliberate — a store that
 * can cover eight of nine components should be able to release those eight.
 */
export function issueMaterial(orderId: string, only?: string[]): IssueResult {
  const order = ordersRepo.get(orderId)
  if (!order) return { ok: false, issued: [], short: [], error: 'Order not found' }
  if (order.status === 'cancelled') return { ok: false, issued: [], short: [], error: 'This order is cancelled' }

  const plan = plansRepo.liveWithLines(orderId)
  if (!plan) {
    return { ok: false, issued: [], short: [], error: 'Plan this order first, then material can be issued against it.' }
  }

  const wanted = only?.length ? plan.lines.filter((line) => only.includes(line.rmItemId)) : plan.lines
  if (!wanted.length) return { ok: false, issued: [], short: [], error: 'Nothing selected to issue' }

  const issued: IssueResult['issued'] = []
  const short: IssueResult['short'] = []

  try {
    transaction(() => {
      for (const line of wanted) {
        const outstanding = atLeastZero(line.qtyRequired - line.alreadyIssued)
        if (outstanding <= 0) continue

        // Real stock on hand, not free stock: a commitment is a plan, and issuing is
        // precisely the act of turning this order's own commitment into a movement.
        const onHand = movesRepo.stockFor(line.rmItemId)
        const toIssue = round(Math.min(outstanding, Math.max(onHand, 0)))

        if (toIssue <= 0) {
          short.push({ itemId: line.rmItemId, code: line.rmCode, wanted: outstanding, issued: 0 })
          continue
        }

        const result = movesRepo.create({
          itemId: line.rmItemId,
          direction: 'out',
          qty: toIssue,
          reason: 'issue',
          orderId,
          referenceNo: order.orderNo,
          remarks: `Issued to order ${order.orderNo} (${order.fgCode})`
        })
        if (!result.ok) throw new Error(result.error ?? `Could not issue ${line.rmCode}`)

        issued.push({ itemId: line.rmItemId, code: line.rmCode, qty: toIssue })
        if (gt(outstanding, toIssue)) {
          short.push({ itemId: line.rmItemId, code: line.rmCode, wanted: outstanding, issued: toIssue })
        }
      }

      // movesRepo.create() already walked the plan's issued figures forward, which is
      // what shrinks this order's outstanding commitment.
      if (issued.length && order.status === 'planned') ordersRepo.setStatus(orderId, 'in_production')
    })
  } catch (err) {
    return { ok: false, issued: [], short: [], error: err instanceof Error ? err.message : String(err) }
  }

  log.info('planning', `issued ${issued.length} component(s) to ${order.orderNo}, ${short.length} short`)
  return { ok: issued.length > 0, issued, short }
}

/**
 * Books finished units into stock against an order. The workbook had no concept of
 * this — finished goods only ever appeared if someone remembered to add an INWARD row.
 */
export function bookProduction(orderId: string, qty: number, remarks?: string): { ok: boolean; error?: string } {
  const order = ordersRepo.get(orderId)
  if (!order) return { ok: false, error: 'Order not found' }
  if (!(qty > 0)) return { ok: false, error: 'Quantity must be greater than zero' }

  const alreadyProduced = movesRepo.producedForOrder(orderId)
  if (gt(alreadyProduced + qty, order.qtyOrdered)) {
    return {
      ok: false,
      error: `${order.orderNo} is for ${order.qtyOrdered} ${order.fgUnit}. ${alreadyProduced} already booked, so ${round(order.qtyOrdered - alreadyProduced)} is the most that can be added.`
    }
  }

  return transaction(() => {
    const result = movesRepo.create({
      itemId: order.fgItemId,
      direction: 'in',
      qty,
      reason: 'production',
      orderId,
      referenceNo: order.orderNo,
      remarks: remarks?.trim() || `Produced against order ${order.orderNo}`
    })
    if (!result.ok) return { ok: false, error: result.error }

    // The order is fully built, so it stops holding stock: completing it drops the
    // plan out of `item_committed` and frees anything it had reserved but not issued.
    if (!gt(order.qtyOrdered, alreadyProduced + qty)) {
      ordersRepo.setStatus(orderId, 'completed')
      log.info('planning', `order ${order.orderNo} completed (${order.qtyOrdered} ${order.fgUnit})`)
    } else if (order.status === 'planned' || order.status === 'draft') {
      ordersRepo.setStatus(orderId, 'in_production')
    }
    return { ok: true }
  })
}

/**
 * Every shortage across every live plan, grouped by who sells the part.
 *
 * The workbook put supplier name and contact on each planning row, which told you who
 * to call but not that four different orders all needed the same bracket from the same
 * vendor. Grouping turns nine rows into one phone call, and the lead time turns a
 * shortage into a date.
 */
export function purchaseSuggestions(): PurchaseSuggestion[] {
  const rows = plansRepo.openShortageLines()
  const bySupplier = new Map<string, PurchaseSuggestion>()

  for (const row of rows) {
    const key = row.supplierId ?? '__none__'
    let group = bySupplier.get(key)
    if (!group) {
      group = {
        supplierId: row.supplierId,
        // Unassigned parts are grouped too, so they are chased rather than lost.
        supplierName: row.supplierName ?? 'No supplier set',
        supplierContact: row.supplierContact,
        supplierPhone: row.supplierPhone,
        leadTimeDays: row.leadTimeDays,
        lines: [],
        totalLines: 0
      }
      bySupplier.set(key, group)
    }

    // The same part short on several orders is one purchase, not several.
    let line = group.lines.find((l) => l.itemId === row.itemId)
    if (!line) {
      line = {
        itemId: row.itemId,
        code: row.code,
        name: row.name,
        unit: row.unit,
        shortage: 0,
        orders: [],
        orderByDate: null
      }
      group.lines.push(line)
    }

    line.shortage = round(line.shortage + row.shortage)
    line.orders.push({ orderId: row.orderId, orderNo: row.orderNo, qty: row.shortage, dueDate: row.dueDate })

    // Work backwards from the earliest thing this part is holding up.
    const dueDates = line.orders.map((o) => o.dueDate).filter((d): d is number => d != null)
    if (dueDates.length) {
      const earliest = Math.min(...dueDates)
      line.orderByDate = earliest - (row.leadTimeDays ?? 0) * DAY
    }
  }

  for (const group of bySupplier.values()) {
    group.lines.sort((a, b) => {
      // Most urgent first, then biggest.
      if (a.orderByDate != null && b.orderByDate != null && a.orderByDate !== b.orderByDate) {
        return a.orderByDate - b.orderByDate
      }
      if (a.orderByDate != null && b.orderByDate == null) return -1
      if (a.orderByDate == null && b.orderByDate != null) return 1
      return b.shortage - a.shortage
    })
    for (const line of group.lines) line.orders.sort((a, b) => b.qty - a.qty)
    group.totalLines = group.lines.length
  }

  return [...bySupplier.values()].sort((a, b) => {
    // Parts with nobody to buy them from surface last but are never dropped.
    if (a.supplierId === null && b.supplierId !== null) return 1
    if (a.supplierId !== null && b.supplierId === null) return -1
    return a.supplierName.localeCompare(b.supplierName)
  })
}
