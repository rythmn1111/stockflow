import type { LocationSummary, OrderPacking, PackingBreakdown, PickList, PickListLine, WeightRollup } from '@shared/types'
import { itemsRepo } from '../db/items'
import { movesRepo } from '../db/moves'
import { ordersRepo } from '../db/orders'
import { plansRepo } from '../db/plans'
import { bomRepo } from '../db/bom'
import { query } from '../db/connection'
import { atLeastZero, round } from '../lib/num'

/**
 * Features built on the four Item_Master columns the workbook stored but never used:
 * `Quantity Packed`, `Packing Box Details`, `Net Weight` and `Gross Weight`, plus
 * `Location`.
 *
 * Each one answers a question somebody on the floor actually asks — how many cartons,
 * what will it weigh, and in what order do I walk the shelves — and each is arithmetic
 * a spreadsheet could have done but nobody had wired up.
 */

/** Boxes and weight for a given quantity of one item. */
export function packingFor(itemId: string, qty: number): PackingBreakdown | null {
  // The with-stock shape carries the chosen box's label and tare weight.
  const item = itemsRepo.get(itemId)
  if (!item) return null

  const unitsPerBox = item.quantityPacked && item.quantityPacked > 0 ? item.quantityPacked : null
  const net = item.netWeight != null && item.netWeight > 0 ? item.netWeight : null
  const gross = item.grossWeight != null && item.grossWeight > 0 ? item.grossWeight : null

  const fullBoxes = unitsPerBox ? Math.floor(qty / unitsPerBox) : 0
  const loose = unitsPerBox ? round(qty - fullBoxes * unitsPerBox) : round(qty)

  return {
    itemId: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    qty: round(qty),
    unitsPerBox,
    boxDetails: item.packingBoxLabel,
    fullBoxes,
    loose,
    // A part-filled carton still costs a carton, hence the ceiling.
    totalBoxes: unitsPerBox ? Math.ceil(qty / unitsPerBox) : null,
    netWeightPerUnit: net,
    grossWeightPerUnit: gross,
    // Gross below net is a data-entry slip, not negative packaging, so it is suppressed.
    packagingWeightPerUnit: net != null && gross != null && gross >= net ? round(gross - net, 3) : null,
    totalNetWeight: net != null ? round(net * qty, 3) : null,
    totalGrossWeight: gross != null ? round(gross * qty, 3) : null,
    // The cartons themselves weigh something, which matters for a freight quote.
    boxesWeight:
      item.packingBoxEmptyWeight != null && unitsPerBox
        ? round(item.packingBoxEmptyWeight * Math.ceil(qty / unitsPerBox), 3)
        : null
  }
}

/** What one order ships as: cartons, loose units, and shipping weight. */
export function orderPacking(orderId: string): OrderPacking | null {
  const order = ordersRepo.get(orderId)
  if (!order) return null

  const finished = packingFor(order.fgItemId, order.qtyOrdered)
  if (!finished) return null

  // Named explicitly so a half-answer is never mistaken for a whole one.
  const gaps: string[] = []
  if (finished.unitsPerBox == null) gaps.push('Quantity Packed is not set, so carton count is unknown')
  if (finished.netWeightPerUnit == null) gaps.push('Net Weight is not set')
  if (finished.grossWeightPerUnit == null) gaps.push('Gross Weight is not set')
  if (!finished.boxDetails) gaps.push('No packing box chosen')

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    customer: order.customer,
    finished,
    gaps
  }
}

/**
 * Order weight from both ends. Material weight comes off the exploded BOM rather than
 * the saved plan, so it answers "what does building this cost in kilos" even before
 * the order has been planned.
 */
export function weightRollup(orderId: string): WeightRollup | null {
  const order = ordersRepo.get(orderId)
  if (!order) return null

  const fg = itemsRepo.getPlain(order.fgItemId)
  const finishedNet = fg?.netWeight != null ? round(fg.netWeight * order.qtyOrdered, 3) : null
  const finishedGross = fg?.grossWeight != null ? round(fg.grossWeight * order.qtyOrdered, 3) : null

  const { lines } = bomRepo.explode(order.fgItemId, order.qtyOrdered)
  let materialNet: number | null = null
  let materialGross: number | null = null
  const missingWeightCodes: string[] = []

  for (const line of lines) {
    const item = itemsRepo.getPlain(line.itemId)
    if (!item) continue
    if (item.netWeight == null && item.grossWeight == null) {
      missingWeightCodes.push(item.code)
      continue
    }
    if (item.netWeight != null) materialNet = round((materialNet ?? 0) + item.netWeight * line.qty, 3)
    if (item.grossWeight != null) materialGross = round((materialGross ?? 0) + item.grossWeight * line.qty, 3)
  }

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    finishedNet,
    finishedGross,
    materialNet,
    materialGross,
    missingWeightCodes,
    netDifference: materialNet != null && finishedNet != null ? round(materialNet - finishedNet, 3) : null
  }
}

/**
 * The live plan, reorganised into a walking route.
 *
 * The workbook listed material in bill-of-materials order and kept `Location` in a
 * column nothing sorted by, which means the storeman crosses the floor once per
 * component. Grouping by location turns that into one stop per shelf.
 */
export function pickListFor(orderId: string): PickList | null {
  const order = ordersRepo.get(orderId)
  if (!order) return null

  const plan = plansRepo.liveWithLines(orderId)
  if (!plan) return null

  const byLocation = new Map<string, PickListLine[]>()
  const unlocated: PickListLine[] = []
  let shortfallLines = 0

  for (const line of plan.lines) {
    const outstanding = atLeastZero(line.qtyRequired - line.alreadyIssued)
    if (outstanding <= 0) continue

    const item = itemsRepo.getPlain(line.rmItemId)
    const onHand = movesRepo.stockFor(line.rmItemId)
    const shortfall = atLeastZero(outstanding - Math.max(onHand, 0))
    if (shortfall > 0) shortfallLines++

    const entry: PickListLine = {
      itemId: line.rmItemId,
      code: line.rmCode,
      name: line.rmName,
      unit: line.rmUnit,
      location: item?.location ?? null,
      rack: item?.rack ?? null,
      qtyToPick: outstanding,
      onHand: round(onHand),
      shortfall
    }

    if (entry.location) {
      const bucket = byLocation.get(entry.location) ?? []
      bucket.push(entry)
      byLocation.set(entry.location, bucket)
    } else {
      unlocated.push(entry)
    }
  }

  const stops = [...byLocation.entries()]
    .map(([location, lines]) => ({
      location,
      // Within a location, by rack first so the walk goes along the shelves in order,
      // then by code. Numeric-aware, so rack 2 comes before rack 10.
      lines: lines.sort(
        (a, b) =>
          (a.rack ?? '').localeCompare(b.rack ?? '', undefined, { numeric: true }) ||
          a.code.localeCompare(b.code, undefined, { numeric: true })
      ),
      lineCount: lines.length
    }))
    // Numeric-aware so bin A-2 comes before A-10, which plain text gets wrong.
    .sort((a, b) => a.location.localeCompare(b.location, undefined, { numeric: true }))

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    fgCode: order.fgCode,
    fgName: order.fgName,
    qtyOrdered: order.qtyOrdered,
    stops,
    unlocated: unlocated.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    totalLines: stops.reduce((sum, stop) => sum + stop.lineCount, 0) + unlocated.length,
    shortfallLines
  }
}

/**
 * Stock rolled up by where it physically sits — a shelf-by-shelf view for stock-taking,
 * which the workbook could not produce because Location was never grouped on.
 */
export function locationSummaries(): LocationSummary[] {
  const rows = query<{
    location: string
    item_count: number
    below: number
    total_units: number | null
    total_net: number | null
  }>(
    `SELECT i.location,
            COUNT(*) AS item_count,
            SUM(CASE
                  WHEN i.reorder_level > 0
                   AND COALESCE(st.current_stock, i.opening_stock) - COALESCE(c.committed, 0) <= i.reorder_level
                  THEN 1 ELSE 0
                END) AS below,
            SUM(COALESCE(st.current_stock, i.opening_stock)) AS total_units,
            SUM(CASE
                  WHEN i.net_weight IS NOT NULL
                  THEN i.net_weight * COALESCE(st.current_stock, i.opening_stock)
                  ELSE 0
                END) AS total_net
       FROM items i
       LEFT JOIN item_stock st    ON st.item_id = i.id
       LEFT JOIN item_committed c ON c.item_id = i.id
      WHERE i.archived_at IS NULL AND i.location IS NOT NULL AND i.location != ''
      GROUP BY i.location
      ORDER BY i.location COLLATE NOCASE ASC`
  )

  return rows.map((r) => ({
    location: r.location,
    itemCount: r.item_count,
    belowReorderCount: r.below,
    totalUnits: round(r.total_units ?? 0),
    totalNetWeight: r.total_net ? round(r.total_net, 3) : null
  }))
}
