/**
 * Packing, weight and picking — the features built on the Item_Master columns the
 * workbook stored but never read: Quantity Packed, Packing Box Details, Net Weight,
 * Gross Weight and Location.
 *
 * Run with: bun run smoke:packing
 */
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/main/db/connection'
import { itemsRepo } from '../src/main/db/items'
import { bomRepo } from '../src/main/db/bom'
import { ordersRepo } from '../src/main/db/orders'
import { movesRepo } from '../src/main/db/moves'
import { planOrder } from '../src/main/services/planning'
import { locationSummaries, orderPacking, packingFor, pickListFor, weightRollup } from '../src/main/services/packing'

let failures = 0
function check(label: string, condition: unknown, extra?: unknown): void {
  const ok = !!condition
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === undefined ? '' : `  → ${JSON.stringify(extra)}`}`)
}

const dir = mkdtempSync(join(tmpdir(), 'stockflow-pack-'))
openDatabase(dir)

/* -------------------------------- packing ------------------------------- */

const { item: boxed } = itemsRepo.create({
  code: 'FG-BOX',
  name: 'Boxed widget',
  unit: 'Nos.',
  type: 'FG',
  quantityPacked: 24,
  packingBoxDetails: 'Carton 300×200×150',
  netWeight: 0.5,
  grossWeight: 0.65
})

const exact = packingFor(boxed.id, 48)!
check('a whole number of boxes has no remainder', exact.fullBoxes === 2 && exact.loose === 0)
check('total boxes matches', exact.totalBoxes === 2)

const partial = packingFor(boxed.id, 50)!
check('a part box is counted', partial.fullBoxes === 2 && partial.loose === 2)
check('a part-filled carton still costs a carton', partial.totalBoxes === 3, partial.totalBoxes)
check('net weight scales with quantity', partial.totalNetWeight === 25)
check('gross weight scales with quantity', partial.totalGrossWeight === 32.5)
check('packaging weight is gross minus net', partial.packagingWeightPerUnit === 0.15,
  partial.packagingWeightPerUnit)
check('box details are carried through', partial.boxDetails === 'Carton 300×200×150')

const single = packingFor(boxed.id, 1)!
check('one unit still needs one box', single.totalBoxes === 1 && single.fullBoxes === 0 && single.loose === 1)

const { item: unboxed } = itemsRepo.create({ code: 'FG-BARE', name: 'No packing data', type: 'FG' })
const bare = packingFor(unboxed.id, 10)!
check('a missing units-per-box gives no box count', bare.totalBoxes === null)
check('and reports the whole quantity as loose', bare.loose === 10)
check('a missing weight stays null rather than zero', bare.totalNetWeight === null)

const { item: badWeight } = itemsRepo.create({
  code: 'FG-BADW', name: 'Gross below net', type: 'FG', netWeight: 5, grossWeight: 3
})
check('gross below net is suppressed rather than shown negative',
  packingFor(badWeight.id, 1)!.packagingWeightPerUnit === null)

/* ---------------------------- order packing ----------------------------- */

const { order: oBox } = ordersRepo.create({
  orderNo: 'PK-1', orderDate: Date.now(), fgItemId: boxed.id, qtyOrdered: 50, customer: 'Acme'
})
const pack = orderPacking(oBox.id)!
check('order packing uses the order quantity', pack.finished.qty === 50)
check('order packing reports three cartons', pack.finished.totalBoxes === 3)
check('order packing names the customer', pack.customer === 'Acme')
check('a complete item reports no gaps', pack.gaps.length === 0, pack.gaps)

const { order: oBare } = ordersRepo.create({
  orderNo: 'PK-2', orderDate: Date.now(), fgItemId: unboxed.id, qtyOrdered: 5
})
const barePack = orderPacking(oBare.id)!
check('missing fields are named explicitly', barePack.gaps.length === 4, barePack.gaps.length)
check('and say which field is missing', barePack.gaps.some((g) => /Quantity Packed/.test(g)))

/* ------------------------------- weights -------------------------------- */

const { item: heavy } = itemsRepo.create({
  code: 'RM-HEAVY', name: 'Steel plate', type: 'RM', openingStock: 100, netWeight: 3, grossWeight: 3.2, location: 'B-1'
})
const { item: light } = itemsRepo.create({
  code: 'RM-LIGHT', name: 'Clip', type: 'RM', openingStock: 100, netWeight: 0.1, grossWeight: 0.12, location: 'A-1'
})
const { item: noWeight } = itemsRepo.create({
  code: 'RM-NOWT', name: 'Unweighed', type: 'RM', openingStock: 100, location: 'A-2'
})

const { item: assembly } = itemsRepo.create({
  code: 'FG-ASM', name: 'Assembly', type: 'FG', netWeight: 6.4, grossWeight: 7, quantityPacked: 2
})
bomRepo.addLine({ fgItemId: assembly.id, rmItemId: heavy.id, qtyPerUnit: 2 })
bomRepo.addLine({ fgItemId: assembly.id, rmItemId: light.id, qtyPerUnit: 4 })
bomRepo.addLine({ fgItemId: assembly.id, rmItemId: noWeight.id, qtyPerUnit: 1 })

const { order: oAsm } = ordersRepo.create({
  orderNo: 'WT-1', orderDate: Date.now(), fgItemId: assembly.id, qtyOrdered: 10, dueDate: Date.now() + 86_400_000
})
const weight = weightRollup(oAsm.id)!
check('finished weight is unit weight times quantity', weight.finishedNet === 64)
check('material weight comes off the exploded bom', weight.materialNet === 64, weight.materialNet)
check('unweighed components are named, not silently zeroed',
  weight.missingWeightCodes.includes('RM-NOWT'))
check('the net difference is reported', weight.netDifference === 0, weight.netDifference)

/* ------------------------------ pick list ------------------------------- */

check('a pick list needs a plan first', pickListFor(oAsm.id) === null)
planOrder(oAsm.id)
const pick = pickListFor(oAsm.id)!
check('the pick list covers every component', pick.totalLines === 3, pick.totalLines)
check('lines are grouped into one stop per location', pick.stops.length === 3, pick.stops.length)
check('stops are in shelf order', pick.stops.map((s) => s.location).join(',') === 'A-1,A-2,B-1',
  pick.stops.map((s) => s.location))
check('quantities to pick come from the plan',
  pick.stops.find((s) => s.location === 'B-1')!.lines[0]!.qtyToPick === 20)
check('on-hand is shown beside what is needed',
  pick.stops.find((s) => s.location === 'B-1')!.lines[0]!.onHand === 100)
check('nothing is short when stock covers it', pick.shortfallLines === 0)

// Numeric-aware ordering: B-10 must come after B-2, which plain text gets wrong.
itemsRepo.update(noWeight.id, { location: 'B-10' })
itemsRepo.update(light.id, { location: 'B-2' })
planOrder(oAsm.id)
const ordered = pickListFor(oAsm.id)!
check('shelf order is numeric, not alphabetical',
  ordered.stops.map((s) => s.location).join(',') === 'B-1,B-2,B-10',
  ordered.stops.map((s) => s.location))

// An item with no location slows every pick down, so it is called out separately.
itemsRepo.update(noWeight.id, { location: null })
planOrder(oAsm.id)
const withUnlocated = pickListFor(oAsm.id)!
check('unlocated items are separated out', withUnlocated.unlocated.length === 1)
check('and still counted in the total', withUnlocated.totalLines === 3)

// Issuing removes a line from the next pick: it has already left the shelf.
movesRepo.create({ itemId: heavy.id, direction: 'out', qty: 20, reason: 'issue', orderId: oAsm.id })
const afterIssue = pickListFor(oAsm.id)!
check('an issued line drops off the pick list', afterIssue.totalLines === 2, afterIssue.totalLines)

// Shortfall is flagged against what is physically there.
itemsRepo.update(light.id, { openingStock: 5 })
planOrder(oAsm.id)
const shortPick = pickListFor(oAsm.id)!
check('a line the shelf cannot cover is flagged', shortPick.shortfallLines === 1, shortPick.shortfallLines)

/* --------------------------- location summary --------------------------- */

const locations = locationSummaries()
check('locations are summarised', locations.length >= 2, locations.length)
check('each location counts its items', locations.every((l) => l.itemCount >= 1))
check('location weight is rolled up', locations.some((l) => (l.totalNetWeight ?? 0) > 0))
check('an unlocated item is excluded', !locations.some((l) => l.location === ''))

closeDatabase()
rmSync(dir, { recursive: true, force: true })

console.log(`\n=== PACKING ${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} ===`)
process.exit(failures === 0 ? 0 : 1)
