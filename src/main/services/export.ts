import { writeFileSync } from 'node:fs'
import type { MoveQuery } from '@shared/types'
import { bomRepo } from '../db/bom'
import { itemsRepo } from '../db/items'
import { movesRepo } from '../db/moves'
import { ordersRepo } from '../db/orders'
import { plansRepo } from '../db/plans'
import { settingsRepo } from '../db/settings'
import { purchaseSuggestions } from './planning'
import { pickListFor } from './packing'
import { round } from '../lib/num'

/**
 * CSV writers for the printable reports.
 *
 * CSV rather than a spreadsheet library on purpose: these are things somebody prints,
 * emails, or opens once — a purchase list, a pick list, a stock register as of today.
 * Writing real .xlsx would mean a dependency and a file format to maintain for output
 * nobody edits.
 */

function escapeCsv(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n')
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A title block so a printed report says what it is and when it was true. */
function heading(title: string): string[][] {
  const { companyName } = settingsRepo.getAll()
  const rows: string[][] = []
  if (companyName) rows.push([companyName])
  rows.push([title])
  rows.push([`Generated ${new Date().toLocaleString()}`])
  rows.push([])
  return rows
}

function write(path: string, prefixRows: string[][], header: string[], rows: unknown[][]): void {
  const prefix = prefixRows.map((row) => row.map(escapeCsv).join(',')).join('\n')
  writeFileSync(path, `${prefix}\n${toCsv(header, rows)}\n`, 'utf8')
}

export const defaultNames = {
  items: () => `stock-register-${stamp()}.csv`,
  bom: () => `bill-of-materials-${stamp()}.csv`,
  ledger: () => `material-log-${stamp()}.csv`,
  plan: (orderNo: string) => `material-plan-${orderNo}-${stamp()}.csv`,
  pickList: (orderNo: string) => `pick-list-${orderNo}-${stamp()}.csv`,
  purchasing: () => `purchase-list-${stamp()}.csv`
}

/**
 * The stock register report — the workbook's Stock_Register sheet, except the numbers
 * are computed rather than kept in 774 rows of formulas, and `Free` and `Committed`
 * are columns it never had.
 */
export function exportItems(path: string): number {
  const items = itemsRepo.exportAll()
  write(
    path,
    heading('Stock Register'),
    [
      'Item Code', 'Item Name', 'Unit', 'Type', 'Opening', 'Inward', 'Outward',
      'Current Stock', 'Committed', 'Free Stock', 'Reorder Level', 'Below Reorder',
      'Location', 'Supplier', 'Net Weight', 'Gross Weight', 'Packing Box Details',
      'Qty Packed', 'Used In BOMs', 'Last Movement'
    ],
    items.map((i) => [
      i.code, i.name, i.unit, i.type, i.openingStock, i.totalInward, i.totalOutward,
      i.currentStock, i.committed, i.freeStock, i.reorderLevel, i.belowReorder ? 'YES' : '',
      i.location, i.supplierName, i.netWeight, i.grossWeight, i.packingBoxDetails,
      i.quantityPacked, i.usedInBomCount,
      i.lastMovedAt ? new Date(i.lastMovedAt).toLocaleDateString() : ''
    ])
  )
  return items.length
}

export function exportBom(path: string): number {
  const lines = bomRepo.list()
  write(
    path,
    heading('Bill of Materials'),
    ['FG Code', 'FG Name', 'RM Code', 'RM Description', 'Qty Required', 'Unit', 'Scrap %', 'Supplier', 'Notes'],
    lines.map((l) => [
      l.fgCode, l.fgName, l.rmCode, l.rmName, l.qtyPerUnit, l.rmUnit,
      l.scrapPercent || '', l.supplierName, l.notes
    ])
  )
  return lines.length
}

export function exportLedger(path: string, q: MoveQuery = {}): number {
  const moves = movesRepo.exportRows(q)
  write(
    path,
    heading('Material Log'),
    ['Date', 'Direction', 'Reason', 'Item Code', 'Item Name', 'Qty', 'Unit', 'Reference', 'Order', 'Remarks', 'Voided', 'Void Reason'],
    moves.map((m) => [
      new Date(m.movedAt).toLocaleDateString(),
      m.direction === 'in' ? 'INWARD' : 'OUTWARD',
      m.reason, m.itemCode, m.itemName, m.qty, m.itemUnit,
      m.referenceNo, m.orderNo, m.remarks,
      m.voidedAt ? new Date(m.voidedAt).toLocaleDateString() : '',
      m.voidedReason
    ])
  )
  return moves.length
}

/**
 * One order's material plan. Unlike the workbook's shared planning sheet, this is the
 * plan for *this* order and stays valid when another order is planned.
 */
export function exportPlan(path: string, orderId: string): number {
  const plan = plansRepo.liveWithLines(orderId)
  if (!plan) return 0

  const prefix = heading(`Material Plan — Order ${plan.order.orderNo}`)
  prefix.splice(prefix.length - 1, 0,
    [`Product: ${plan.order.fgCode} — ${plan.order.fgName}`],
    [`Quantity: ${plan.order.qtyOrdered} ${plan.order.fgUnit}`],
    [`Planned: ${new Date(plan.createdAt).toLocaleString()}`],
    plan.order.dueDate ? [`Due: ${new Date(plan.order.dueDate).toLocaleDateString()}`] : ['']
  )

  write(
    path,
    prefix,
    ['Level', 'RM Code', 'RM Name', 'Unit', 'Qty Required', 'Already Issued', 'Stock Available', 'Shortage', 'Location', 'Supplier', 'Contact'],
    plan.lines.map((l) => [
      l.depth, l.rmCode, l.rmName, l.rmUnit, l.qtyRequired, l.alreadyIssued,
      l.stockAvailable, l.shortage || '',
      itemsRepo.getPlain(l.rmItemId)?.location ?? '',
      l.supplierName, l.supplierContact ?? l.supplierPhone
    ])
  )
  return plan.lines.length
}

/** The walking route, printed for the store. */
export function exportPickList(path: string, orderId: string): number {
  const list = pickListFor(orderId)
  if (!list) return 0

  const prefix = heading(`Pick List — Order ${list.orderNo}`)
  prefix.splice(prefix.length - 1, 0,
    [`Product: ${list.fgCode} — ${list.fgName} × ${list.qtyOrdered}`],
    [`${list.totalLines} line(s) across ${list.stops.length} location(s)`],
    ['']
  )

  const rows: unknown[][] = []
  for (const stop of list.stops) {
    // A blank label on continuation rows keeps each shelf visually one block.
    stop.lines.forEach((line, index) => {
      rows.push([
        index === 0 ? stop.location : '',
        line.code, line.name, line.qtyToPick, line.unit, line.onHand,
        line.shortfall || '', '' // trailing column is the tick box
      ])
    })
  }
  for (const line of list.unlocated) {
    rows.push(['(no location)', line.code, line.name, line.qtyToPick, line.unit, line.onHand, line.shortfall || '', ''])
  }

  write(path, prefix, ['Location', 'Item Code', 'Item Name', 'Qty to Pick', 'Unit', 'On Hand', 'Short', 'Picked'], rows)
  return rows.length
}

/**
 * The purchase list, grouped by supplier. This is the report the workbook could not
 * produce at all: its planning sheet held one order, so it could never show that four
 * orders all need the same bracket from the same vendor.
 */
export function exportPurchasing(path: string): number {
  const groups = purchaseSuggestions()
  const rows: unknown[][] = []

  for (const group of groups) {
    group.lines.forEach((line, index) => {
      rows.push([
        index === 0 ? group.supplierName : '',
        index === 0 ? (group.supplierContact ?? group.supplierPhone ?? '') : '',
        index === 0 && group.leadTimeDays != null ? `${group.leadTimeDays} days` : '',
        line.code,
        line.name,
        line.shortage,
        line.unit,
        line.orderByDate ? new Date(line.orderByDate).toLocaleDateString() : '',
        line.orders.map((o) => `${o.orderNo} (${round(o.qty)})`).join('; ')
      ])
    })
  }

  write(
    path,
    heading('Purchase List — shortages across all open orders'),
    ['Supplier', 'Contact', 'Lead Time', 'Item Code', 'Item Name', 'Qty Short', 'Unit', 'Order By', 'Driven By'],
    rows
  )
  return rows.length
}

/** Full snapshot as JSON — the escape hatch, so the data is never trapped in here. */
export function exportJson(path: string, appVersion: string): void {
  writeFileSync(
    path,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        appVersion,
        settings: settingsRepo.getAll(),
        items: itemsRepo.exportAll(),
        bom: bomRepo.list(),
        orders: ordersRepo.exportAll(),
        ledger: movesRepo.list({ includeVoided: true, limit: 2000 }).items,
        purchasing: purchaseSuggestions()
      },
      null,
      2
    ),
    'utf8'
  )
}
