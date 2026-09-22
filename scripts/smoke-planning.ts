/**
 * Material planning, issuing and purchasing — the logic that replaces the workbook's
 * `ProcessOrder` macro. Every case here is one the macro got wrong or could not express.
 *
 * Run with: bun run smoke:planning
 */
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/main/db/connection'
import { suppliersRepo } from '../src/main/db/suppliers'
import { itemsRepo } from '../src/main/db/items'
import { bomRepo } from '../src/main/db/bom'
import { ordersRepo } from '../src/main/db/orders'
import { movesRepo } from '../src/main/db/moves'
import { plansRepo } from '../src/main/db/plans'
import { bookProduction, issueMaterial, planOrder, purchaseSuggestions } from '../src/main/services/planning'

let failures = 0
function check(label: string, condition: unknown, extra?: unknown): void {
  const ok = !!condition
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'stockflow-plan-'))
openDatabase(dir)

/* ---- The exact scenario from the workbook: 9 raw materials, opening stock 10 ---- */

const rm: Record<string, string> = {}
const bomQty: Record<string, number> = {
  'RM-01': 1, 'RM-02': 2, 'RM-03': 4, 'RM-04': 2, 'RM-05': 1,
  'RM-06': 2, 'RM-07': 4, 'RM-08': 6, 'RM-09': 7
}

let index = 1
for (const code of Object.keys(bomQty)) {
  const supplier = suppliersRepo.ensure(`S-${index}`, `C-${index}`)
  const { item } = itemsRepo.create({
    code,
    name: 'ABC',
    unit: 'Nos.',
    type: 'RM',
    openingStock: 10,
    reorderLevel: 10,
    suppliers: supplier ? [{ supplierId: supplier.id }] : [],
    location: `A-${index}`
  })
  rm[code] = item.id
  index++
}

const { item: fg } = itemsRepo.create({ code: 'AEH-01', name: 'AEH-01', unit: 'Nos.', type: 'FG' })
for (const [code, qty] of Object.entries(bomQty)) {
  bomRepo.addLine({ fgItemId: fg.id, rmItemId: rm[code]!, qtyPerUnit: qty })
}

// The workbook's own Material_Log: one inward on RM-01, then outwards for order 55.
movesRepo.create({ itemId: rm['RM-01']!, direction: 'in', qty: 1, reason: 'purchase' })

const { order: o55 } = ordersRepo.create({
  orderNo: '55', orderDate: Date.UTC(2025, 9, 25), fgItemId: fg.id, qtyOrdered: 2, dueDate: Date.UTC(2025, 10, 5)
})

/* ------------------------- planning reproduces the sheet ------------------------ */

const planned = planOrder(o55.id)
check('planning succeeds', planned.ok)
const plan55 = planned.plan!
check('one line per component', plan55.lines.length === 9, plan55.lines.length)
check('planning moves a draft to planned', ordersRepo.get(o55.id)!.status === 'planned')

const line = (code: string) => plan55.lines.find((l) => l.rmCode === code)!
// The workbook's Material_Planning sheet for order 55, reproduced exactly.
check('RM-01 requires 2', line('RM-01').qtyRequired === 2)
check('RM-01 shows 11 available', line('RM-01').stockAvailable === 11, line('RM-01').stockAvailable)
check('RM-01 is not short', line('RM-01').shortage === 0)
check('RM-03 requires 8', line('RM-03').qtyRequired === 8)
check('RM-03 is 8 against 10, not short', line('RM-03').shortage === 0)
check('RM-08 requires 12', line('RM-08').qtyRequired === 12)
check('RM-08 is short by 2', line('RM-08').shortage === 2, line('RM-08').shortage)
check('RM-09 requires 14', line('RM-09').qtyRequired === 14)
check('RM-09 is short by 4', line('RM-09').shortage === 4, line('RM-09').shortage)
check('supplier is attached to each line', line('RM-01').supplierName === 'S-1')
check('supplier contact is attached', line('RM-01').supplierContact === 'C-1')

/* ------ THE BUG: the macro cleared the sheet, so one plan wiped the other ------ */

const { order: o56 } = ordersRepo.create({
  orderNo: '56', orderDate: Date.UTC(2025, 9, 26), fgItemId: fg.id, qtyOrdered: 3, dueDate: Date.UTC(2025, 10, 1)
})
const planned56 = planOrder(o56.id)
check('a second order can be planned', planned56.ok)
check('order 55 still has its plan', plansRepo.liveWithLines(o55.id)!.lines.length === 9)
check('order 56 has its own plan', plansRepo.liveWithLines(o56.id)!.lines.length === 9)
check('the two plans are different rows', plansRepo.liveFor(o55.id)!.id !== plansRepo.liveFor(o56.id)!.id)

/* ---- THE OTHER BUG: both orders saw the same stock and could double-allocate --- */

const line56 = (code: string) => plansRepo.liveWithLines(o56.id)!.lines.find((l) => l.rmCode === code)!
// Order 55 committed 2 of RM-01 out of 11, so order 56 must only see 9.
check('order 56 sees stock reduced by order 55\'s commitment',
  line56('RM-01').stockAvailable === 9, line56('RM-01').stockAvailable)
check('order 56 requires 3 of RM-01', line56('RM-01').qtyRequired === 3)
check('order 56 is not short of RM-01', line56('RM-01').shortage === 0)
// RM-03: 10 on hand, order 55 holds 8, so order 56 sees 2 against a need of 12.
check('order 56 sees only 2 of RM-03 left', line56('RM-03').stockAvailable === 2, line56('RM-03').stockAvailable)
check('order 56 is short 10 of RM-03', line56('RM-03').shortage === 10, line56('RM-03').shortage)
// Both plans are live, so 8 + 12 is outstanding against 10 on the shelf.
check('committed sums every live plan', itemsRepo.get(rm['RM-03']!)!.committed === 20,
  itemsRepo.get(rm['RM-03']!)!.committed)
// Negative free stock is the point: it is the aggregate shortage across open orders.
check('free stock goes negative when more is promised than held',
  itemsRepo.get(rm['RM-03']!)!.freeStock === -10, itemsRepo.get(rm['RM-03']!)!.freeStock)

/* --------------------- re-planning is stable, not cumulative -------------------- */

const replanned = planOrder(o55.id)
check('re-planning succeeds', replanned.ok)
// 11 on hand, order 56 holds 3. Counting order 55's own 2 as well would give 6,
// which would make every re-plan look shorter than the one before it.
const replannedRm01 = replanned.plan!.lines.find((l) => l.rmCode === 'RM-01')!.stockAvailable
check('re-planning excludes the order\'s own commitment', replannedRm01 === 8, replannedRm01)
check('and does not double-count it', replannedRm01 !== 6)
check('the old plan is superseded', plansRepo.historyFor(o55.id).filter((p) => p.supersededAt === null).length === 1)
check('plan history is kept', plansRepo.historyFor(o55.id).length === 2)
// Three plan rows now exist for RM-03 (55 v1, 56, 55 v2) but only two are live, so
// the commitment must stay at 20 rather than climbing to 28.
check('a superseded plan stops committing stock', itemsRepo.get(rm['RM-03']!)!.committed === 20,
  itemsRepo.get(rm['RM-03']!)!.committed)

/* ------------------------------- issuing material ------------------------------ */

const issued = issueMaterial(o55.id)
check('issuing succeeds', issued.ok)
check('issuing writes a ledger entry per component', issued.issued.length === 9, issued.issued.length)
check('issuing moves the order into production', ordersRepo.get(o55.id)!.status === 'in_production')
check('RM-01 fell by 2', movesRepo.stockFor(rm['RM-01']!) === 9, movesRepo.stockFor(rm['RM-01']!))
check('RM-08 issued only what was on the shelf', issued.issued.find((i) => i.code === 'RM-08')!.qty === 10)
check('RM-08 is reported as still short', issued.short.some((s) => s.code === 'RM-08'))
check('the ledger links entries to the order', movesRepo.forOrder(o55.id).length === 9)
check('issued stock is no longer committed',
  plansRepo.liveWithLines(o55.id)!.lines.find((l) => l.rmCode === 'RM-01')!.alreadyIssued === 2)
check('re-issuing an already-issued line does nothing',
  issueMaterial(o55.id).issued.filter((i) => i.code === 'RM-01').length === 0)

/* ----------------------------- booking production ----------------------------- */

check('over-booking is refused', !bookProduction(o55.id, 99).ok)
check('booking one unit works', bookProduction(o55.id, 1).ok)
check('finished goods enter stock', movesRepo.stockFor(fg.id) === 1)
check('a part-built order stays in production', ordersRepo.get(o55.id)!.status === 'in_production')
check('booking the balance completes the order', (() => {
  bookProduction(o55.id, 1)
  return ordersRepo.get(o55.id)!.status === 'completed'
})())
check('a completed order releases its commitment', itemsRepo.get(rm['RM-05']!)!.committed === 3,
  itemsRepo.get(rm['RM-05']!)!.committed)

/* ------------------------------ purchase grouping ----------------------------- */

const suggestions = purchaseSuggestions()
check('shortages are grouped by supplier', suggestions.length > 0, suggestions.length)
check('every group names a supplier', suggestions.every((g) => !!g.supplierName))
const s3 = suggestions.find((g) => g.supplierName === 'S-3')
check('S-3 is listed for RM-03', !!s3 && s3.lines.some((l) => l.code === 'RM-03'))
check('purchase lines carry an order-by date', !!s3?.lines[0]?.orderByDate)
check('purchase lines name the driving orders', (s3?.lines[0]?.orders.length ?? 0) >= 1)

/* ----------------------------- guard rails ----------------------------- */

const { item: bare } = itemsRepo.create({ code: 'FG-NOBOM', name: 'No BOM', type: 'FG' })
const { order: oBare } = ordersRepo.create({
  orderNo: '57', orderDate: Date.now(), fgItemId: bare.id, qtyOrdered: 1
})
const bareResult = planOrder(oBare.id)
check('planning an item with no bom explains itself', !bareResult.ok && /no bill of materials/i.test(bareResult.error!))
check('issuing without a plan is refused', !issueMaterial(oBare.id).ok)

ordersRepo.setStatus(oBare.id, 'cancelled')
check('a cancelled order cannot be planned', !planOrder(oBare.id).ok)

/* -------------------- multi-level bom, which the macro could not do ------------- */

const { item: sub } = itemsRepo.create({ code: 'SUB-01', name: 'Sub-assembly', type: 'FG', openingStock: 0 })
const { item: leaf } = itemsRepo.create({ code: 'RM-LEAF', name: 'Leaf part', type: 'RM', openingStock: 100 })
const { item: top } = itemsRepo.create({ code: 'TOP-01', name: 'Top assembly', type: 'FG' })
bomRepo.addLine({ fgItemId: sub.id, rmItemId: leaf.id, qtyPerUnit: 3 })
bomRepo.addLine({ fgItemId: top.id, rmItemId: sub.id, qtyPerUnit: 5 })

const deep = bomRepo.explode(top.id, 2)
check('explosion walks sub-assemblies', deep.lines.length === 1, deep.lines.length)
check('quantities multiply down the tree', deep.lines[0]!.qty === 30, deep.lines[0]!.qty)
check('only leaves become requirements', deep.lines[0]!.code === 'RM-LEAF')
check('depth is reported', deep.lines[0]!.depth === 2, deep.lines[0]!.depth)

/* ------------------------------ cycle detection ------------------------------- */

check('a direct loop is refused', !bomRepo.addLine({ fgItemId: leaf.id, rmItemId: leaf.id, qtyPerUnit: 1 }).ok)
const loop = bomRepo.addLine({ fgItemId: leaf.id, rmItemId: top.id, qtyPerUnit: 1 })
check('an indirect loop is refused', !loop.ok, loop.error)
check('the loop is named in the error', /→/.test(loop.error ?? ''))

/* ---------------------------------- scrap ------------------------------------- */

const { item: scrapFg } = itemsRepo.create({ code: 'SCRAP-FG', name: 'With scrap', type: 'FG' })
const { item: scrapRm } = itemsRepo.create({ code: 'SCRAP-RM', name: 'Wasteful', type: 'RM', openingStock: 1000 })
bomRepo.addLine({ fgItemId: scrapFg.id, rmItemId: scrapRm.id, qtyPerUnit: 10, scrapPercent: 5 })
check('scrap inflates the requirement', bomRepo.explode(scrapFg.id, 100).lines[0]!.qty === 1050,
  bomRepo.explode(scrapFg.id, 100).lines[0]!.qty)

/* --------------------- a component reached by two paths sums ------------------- */

const { item: shared } = itemsRepo.create({ code: 'SHARED', name: 'Shared part', type: 'RM', openingStock: 500 })
const { item: subA } = itemsRepo.create({ code: 'SUB-A', name: 'Sub A', type: 'FG' })
const { item: parent } = itemsRepo.create({ code: 'PARENT', name: 'Parent', type: 'FG' })
bomRepo.addLine({ fgItemId: subA.id, rmItemId: shared.id, qtyPerUnit: 2 })
bomRepo.addLine({ fgItemId: parent.id, rmItemId: subA.id, qtyPerUnit: 3 })
bomRepo.addLine({ fgItemId: parent.id, rmItemId: shared.id, qtyPerUnit: 1 })
const merged = bomRepo.explode(parent.id, 10)
check('a part on two branches appears once', merged.lines.filter((l) => l.code === 'SHARED').length === 1)
check('its quantities are summed', merged.lines.find((l) => l.code === 'SHARED')!.qty === 70,
  merged.lines.find((l) => l.code === 'SHARED')!.qty)

/* -------------------- editing an order releases its old plan ------------------- */

const { order: oEdit } = ordersRepo.create({
  orderNo: '58', orderDate: Date.now(), fgItemId: scrapFg.id, qtyOrdered: 1
})
planOrder(oEdit.id)
check('the new plan commits stock', itemsRepo.get(scrapRm.id)!.committed === 10.5,
  itemsRepo.get(scrapRm.id)!.committed)
ordersRepo.update(oEdit.id, { qtyOrdered: 4 })
check('changing the quantity supersedes the plan', plansRepo.liveFor(oEdit.id) === null)
check('and releases the commitment', itemsRepo.get(scrapRm.id)!.committed === 0)

closeDatabase()
rmSync(dir, { recursive: true, force: true })

console.log(`\n=== PLANNING ${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} ===`)
process.exit(failures === 0 ? 0 : 1)
