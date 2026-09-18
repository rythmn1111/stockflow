/**
 * Exercises every repository against a throwaway database.
 * Run with: bun run smoke:db
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
import { settingsRepo } from '../src/main/db/settings'
import { statsRepo } from '../src/main/db/stats'

let failures = 0
function check(label: string, condition: unknown, extra?: unknown): void {
  const ok = !!condition
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'stockflow-smoke-'))
openDatabase(dir)

/* ------------------------------- suppliers ------------------------------- */

const s1 = suppliersRepo.create({ name: 'S-1', contact: 'C-1' })
check('supplier created', s1.name === 'S-1' && s1.contact === 'C-1')
check('creating the same name returns the same row', suppliersRepo.create({ name: 'S-1' }).id === s1.id)
check('lookup is case-insensitive', suppliersRepo.byName('s-1')?.id === s1.id)
check('ensure() reuses an existing supplier', suppliersRepo.ensure('S-1')?.id === s1.id)
check('ensure() creates a new one', suppliersRepo.ensure('S-2', 'C-2')?.name === 'S-2')
check('ensure() backfills a missing contact', (() => {
  const blank = suppliersRepo.create({ name: 'S-blank' })
  suppliersRepo.ensure('S-blank', 'later-contact')
  return suppliersRepo.get(blank.id)?.contact === 'later-contact'
})())
check('ensure() ignores blank names', suppliersRepo.ensure('   ') === null)

suppliersRepo.update(s1.id, { leadTimeDays: 7, phone: '+91 90000 00001' })
check('supplier updated', suppliersRepo.get(s1.id)?.leadTimeDays === 7)

/* --------------------------------- items -------------------------------- */

const rm: Record<string, string> = {}
for (let i = 1; i <= 9; i++) {
  const code = `RM-0${i}`
  const supplier = suppliersRepo.ensure(`S-${i}`, `C-${i}`)
  const { item } = itemsRepo.create({
    code,
    name: 'ABC',
    unit: 'Nos.',
    type: 'RM',
    openingStock: 10,
    reorderLevel: 10,
    supplierId: supplier?.id ?? null,
    location: `A-${i}`,
    netWeight: 0.5,
    grossWeight: 0.65,
    quantityPacked: 24,
    packingBoxDetails: 'Carton 300x200x150'
  })
  rm[code] = item.id
}

const { item: fg } = itemsRepo.create({
  code: 'AEH-01',
  name: 'Assembly AEH-01',
  unit: 'Nos.',
  type: 'FG',
  netWeight: 12,
  grossWeight: 14.5,
  quantityPacked: 4,
  packingBoxDetails: 'Wooden crate'
})

check('nine raw materials created', itemsRepo.count('RM') === 9, itemsRepo.count('RM'))
check('one finished good created', itemsRepo.count('FG') === 1)
check('duplicate code returns the existing item', itemsRepo.create({ code: 'rm-01', name: 'x', type: 'RM' }).duplicate)
check('opening stock is the starting balance', itemsRepo.get(rm['RM-01']!)!.currentStock === 10)
check('nothing is committed yet', itemsRepo.get(rm['RM-01']!)!.committed === 0)
check('free stock equals current with no commitments', itemsRepo.get(rm['RM-01']!)!.freeStock === 10)
check('at reorder level counts as below', itemsRepo.get(rm['RM-01']!)!.belowReorder)
check('a zero reorder level never alerts', !itemsRepo.get(fg.id)!.belowReorder)

check('search finds by code', itemsRepo.list({ search: 'rm-03' }).total === 1)
check('search terms are ANDed', itemsRepo.list({ search: 'rm-03 zzz' }).total === 0)
check('search matches location', itemsRepo.list({ search: 'a-5' }).total === 1)
check('type filter works', itemsRepo.list({ type: 'FG' }).total === 1)
check('supplier filter works', itemsRepo.list({ supplierIds: [s1.id] }).total === 1)
check('location filter works', itemsRepo.list({ locations: ['A-2'] }).total === 1)
check('no_reorder_level filter finds the FG', itemsRepo.list({ stockFilter: 'no_reorder_level' }).total === 1)
check('units are collected', itemsRepo.units().includes('Nos.'))
check('locations are collected', itemsRepo.locations().length === 9)

itemsRepo.update(rm['RM-09']!, { reorderLevel: 20, name: 'ABC renamed' })
check('item updated', itemsRepo.get(rm['RM-09']!)!.reorderLevel === 20)
check('rename is searchable', itemsRepo.list({ search: 'renamed' }).total === 1)
check('duplicate code on update is refused', (() => {
  try {
    itemsRepo.update(rm['RM-09']!, { code: 'RM-01' })
    return false
  } catch {
    return true
  }
})())

/* ---------------------------------- bom --------------------------------- */

const bomQty: Record<string, number> = {
  'RM-01': 1, 'RM-02': 2, 'RM-03': 4, 'RM-04': 2, 'RM-05': 1,
  'RM-06': 2, 'RM-07': 4, 'RM-08': 6, 'RM-09': 7
}
for (const [code, qty] of Object.entries(bomQty)) {
  bomRepo.addLine({ fgItemId: fg.id, rmItemId: rm[code]!, qtyPerUnit: qty })
}
check('bom has nine lines', bomRepo.list(fg.id).length === 9)
check('adding the same component twice is refused', !bomRepo.addLine({ fgItemId: fg.id, rmItemId: rm['RM-01']!, qtyPerUnit: 1 }).ok)
check('zero quantity is refused', !bomRepo.addLine({ fgItemId: fg.id, rmItemId: fg.id, qtyPerUnit: 0 }).ok)
check('self-reference is refused', !bomRepo.addLine({ fgItemId: fg.id, rmItemId: fg.id, qtyPerUnit: 1 }).ok)
check('usedIn reports the parent', bomRepo.usedIn(rm['RM-01']!).length === 1)
check('fgWithBom lists the assembly', bomRepo.fgWithBom().some((f) => f.id === fg.id))

/* -------------------------------- orders -------------------------------- */

const { order } = ordersRepo.create({
  orderNo: '55',
  orderDate: Date.UTC(2025, 9, 25),
  fgItemId: fg.id,
  qtyOrdered: 2
})
check('order created', order.orderNo === '55' && order.qtyOrdered === 2)
check('order starts as a draft', order.status === 'draft')
check('duplicate order number returns the existing order', ordersRepo.create({
  orderNo: '55', orderDate: Date.now(), fgItemId: fg.id, qtyOrdered: 9
}).duplicate)
check('zero quantity is refused', (() => {
  try {
    ordersRepo.create({ orderNo: '99', orderDate: Date.now(), fgItemId: fg.id, qtyOrdered: 0 })
    return false
  } catch {
    return true
  }
})())
check('order search matches the product code', ordersRepo.list({ search: 'aeh' }).total === 1)
check('open order counted', ordersRepo.openCount() === 1)

/* --------------------------------- moves -------------------------------- */

const inward = movesRepo.create({ itemId: rm['RM-01']!, direction: 'in', qty: 1, reason: 'purchase' })
check('inward accepted', inward.ok)
check('inward raises stock', movesRepo.stockFor(rm['RM-01']!) === 11)
check('negative quantity is refused', !movesRepo.create({ itemId: rm['RM-01']!, direction: 'in', qty: -5 }).ok)
check('zero quantity is refused', !movesRepo.create({ itemId: rm['RM-01']!, direction: 'in', qty: 0 }).ok)
check('unknown item is refused', !movesRepo.create({ itemId: 'it_nope', direction: 'in', qty: 1 }).ok)
check('unknown order is refused', !movesRepo.create({
  itemId: rm['RM-01']!, direction: 'in', qty: 1, orderId: 'or_nope'
}).ok)

const out = movesRepo.create({ itemId: rm['RM-02']!, direction: 'out', qty: 2, reason: 'issue', orderId: order.id })
check('outward accepted', out.ok)
check('outward lowers stock', movesRepo.stockFor(rm['RM-02']!) === 8)
check('issued-to-order is tracked', movesRepo.issuedToOrder(rm['RM-02']!, order.id) === 2)

check('over-issue is blocked by default', !movesRepo.create({ itemId: rm['RM-03']!, direction: 'out', qty: 999 }).ok)
settingsRepo.update({ blockNegativeStock: false })
const negative = movesRepo.create({ itemId: rm['RM-03']!, direction: 'out', qty: 999 })
check('over-issue is allowed once unblocked', negative.ok)
check('and warns about it', !!negative.warning, negative.warning)
check('negative stock is counted', movesRepo.negativeStockCount() === 1)
movesRepo.void(negative.move!.id, 'smoke test correction')
check('voiding restores the balance', movesRepo.stockFor(rm['RM-03']!) === 10)
check('void needs a reason', !movesRepo.void(out.move!.id, '   ').ok)
check('a voided entry cannot be voided twice', (() => {
  movesRepo.void(out.move!.id, 'first')
  return !movesRepo.void(out.move!.id, 'second').ok
})())
check('voiding an issue clears issued-to-order', movesRepo.issuedToOrder(rm['RM-02']!, order.id) === 0)
settingsRepo.update({ blockNegativeStock: true })

check('ledger hides voided rows by default', movesRepo.list().items.every((m) => m.voidedAt === null))
check('ledger can include voided rows', movesRepo.list({ includeVoided: true }).total > movesRepo.list().total)
check('ledger filters by item', movesRepo.list({ itemId: rm['RM-01']! }).total === 1)
check('ledger filters by direction', movesRepo.list({ direction: 'in' }).items.every((m) => m.direction === 'in'))
check('ledger search matches the item code', movesRepo.list({ search: 'rm-01' }).total === 1)

/* ----------------------------- derived views ---------------------------- */

const asOfBefore = itemsRepo.stockAsOf(Date.UTC(2020, 0, 1))
check('stock as of before any movement is the opening balance',
  asOfBefore.find((r) => r.code === 'RM-01')!.stock === 10)
const asOfNow = itemsRepo.stockAsOf(Date.now() + 1000)
check('stock as of now includes the ledger', asOfNow.find((r) => r.code === 'RM-01')!.stock === 11)
check('balance history spans thirty days', itemsRepo.balanceHistory(rm['RM-01']!).length === 30)
check('balance history ends at the current balance',
  itemsRepo.balanceHistory(rm['RM-01']!).at(-1)!.balance === 11)

/* ------------------------------- deletion ------------------------------- */

check('an item with ledger history cannot be deleted', !itemsRepo.remove(rm['RM-01']!).ok)
check('an item on a bom cannot be deleted', !itemsRepo.remove(rm['RM-05']!).ok)
check('the finished good on an order cannot be deleted', !itemsRepo.remove(fg.id).ok)
const { item: spare } = itemsRepo.create({ code: 'RM-SPARE', name: 'Spare', type: 'RM' })
check('an unreferenced item can be deleted', itemsRepo.remove(spare.id).ok)
itemsRepo.setArchived(rm['RM-08']!, true)
check('archiving hides the item from the active list', itemsRepo.list({ scope: 'active' }).items.every((i) => i.id !== rm['RM-08']))
check('archived items are still reachable', itemsRepo.list({ scope: 'archived' }).total === 1)
itemsRepo.setArchived(rm['RM-08']!, false)

/* ------------------------------- dashboard ------------------------------ */

const stats = statsRepo.dashboard()
check('stats count items', stats.itemCount === 10, stats.itemCount)
check('stats split RM and FG', stats.rmCount === 9 && stats.fgCount === 1)
check('stats count open orders', stats.openOrderCount === 1)
check('stats report below-reorder items', stats.belowReorderCount > 0, stats.belowReorderCount)
check('stats flag items with no reorder level', stats.noReorderLevelCount >= 1)
check('stats chart covers fourteen days', stats.activityByDay.length === 14)
check('stats count this week\'s movements', stats.movesThisWeek >= 1)

closeDatabase()
rmSync(dir, { recursive: true, force: true })

console.log(`\n=== DB ${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} ===`)
process.exit(failures === 0 ? 0 : 1)
