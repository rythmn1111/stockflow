import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { AppSettings, ItemQuery, MoveQuery, OrderQuery, OrderStatus, Supplier } from '@shared/types'
import type { ItemDetail, ItemInput, MoveInput, NewSupplierInput, OrderInput, PhotoInput } from '@shared/api'
import {
  bomRepo,
  getDbPath,
  itemSuppliersRepo,
  itemsRepo,
  packingBoxesRepo,
  photosRepo,
  movesRepo,
  ordersRepo,
  plansRepo,
  settingsRepo,
  statsRepo,
  suppliersRepo,
  run
} from '../db'
import { bookProduction, issueMaterial, planOrder, purchaseSuggestions } from '../services/planning'
import { locationSummaries, orderPacking, pickListFor, weightRollup } from '../services/packing'
import { createBackup, listBackups, stageRestore } from '../services/backup'
import * as exporters from '../services/export'
import { log, errText } from '../lib/log'

export interface IpcContext {
  userDataPath: string
  broadcast: (channel: string, payload: unknown) => void
}

let ctx: IpcContext

function notifyChanged(scope: string): void {
  ctx.broadcast('data:changed', { scope })
}

/** Wraps a handler so a thrown error reaches the renderer as a readable message. */
function handle<TArgs extends unknown[], TResult>(
  channel: string,
  fn: (...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as TArgs))
    } catch (err) {
      log.error('ipc', `${channel} failed`, err)
      throw new Error(err instanceof Error ? err.message : errText(err))
    }
  })
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

/** Shared save-dialog flow for every CSV report. */
async function saveAs(defaultPath: string, extension = 'csv'): Promise<string | null> {
  const win = focusedWindow()
  const options = {
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

export function registerIpc(context: IpcContext): void {
  ctx = context

  /* --------------------------------- app ---------------------------------- */

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataPath: ctx.userDataPath,
    dbPath: getDbPath(),
    logPath: log.getLogFile(),
    isPackaged: app.isPackaged
  }))

  handle('app:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  })

  handle('app:showItemInFolder', (path: string) => {
    shell.showItemInFolder(path)
  })

  handle('app:revealLogs', () => {
    const logPath = log.getLogFile()
    if (logPath) shell.showItemInFolder(logPath)
    else shell.openPath(join(ctx.userDataPath, 'logs'))
  })

  handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  /* ------------------------------- settings -------------------------------- */

  handle('settings:get', () => settingsRepo.getAll())

  handle('settings:update', (patch: Partial<AppSettings>) => {
    const next = settingsRepo.update(patch)
    notifyChanged('settings')
    return next
  })

  handle('settings:completeOnboarding', (payload: { companyName?: string; defaultUnit?: string }) => {
    const next = settingsRepo.update({ ...payload, onboardingCompletedAt: Date.now() })
    notifyChanged('settings')
    return next
  })

  /* ------------------------------- suppliers ------------------------------- */

  handle('suppliers:list', (search?: string) => suppliersRepo.list(search))
  handle('suppliers:get', (id: string) => suppliersRepo.get(id))
  handle('suppliers:itemCount', (id: string) => suppliersRepo.itemCount(id))
  handle('suppliers:detail', (id: string) => suppliersRepo.detail(id))

  handle('suppliers:exportPartsCsv', async (id: string) => {
    const supplier = suppliersRepo.get(id)
    if (!supplier) return { path: null }
    const path = await saveAs(exporters.defaultNames.supplierParts(supplier.name))
    if (!path) return { path: null }
    exporters.exportSupplierParts(path, id)
    return { path }
  })

  handle('suppliers:create', (input: Partial<Supplier> & { name: string }) => {
    const supplier = suppliersRepo.create(input)
    notifyChanged('suppliers')
    return supplier
  })

  handle('suppliers:update', (id: string, patch: Partial<Supplier>) => {
    const supplier = suppliersRepo.update(id, patch)
    notifyChanged('suppliers')
    // Supplier details show on item rows and purchase lists, so those refetch too.
    notifyChanged('items')
    return supplier
  })

  handle('suppliers:remove', (id: string) => {
    const result = suppliersRepo.remove(id)
    notifyChanged('suppliers')
    notifyChanged('items')
    return result
  })

  /* --------------------------------- items -------------------------------- */

  handle('items:list', (query?: ItemQuery) => itemsRepo.list(query ?? {}))
  handle('items:get', (id: string) => itemsRepo.get(id))
  handle('items:byCode', (code: string) => itemsRepo.byCode(code))
  handle('items:locations', () => itemsRepo.locations())
  handle('items:racks', () => itemsRepo.racks())
  handle('items:units', () => itemsRepo.units())
  handle('items:stockAsOf', (at: number) => itemsRepo.stockAsOf(at))

  handle('items:detail', (id: string): ItemDetail | null => {
    const item = itemsRepo.get(id)
    if (!item) return null
    return {
      item,
      suppliers: itemSuppliersRepo.forItem(id),
      componentsOf: bomRepo.list(id),
      usedIn: bomRepo.usedIn(id),
      recentMoves: movesRepo.forItem(id, 50),
      commitments: ordersRepo.commitmentsFor(id),
      balanceHistory: itemsRepo.balanceHistory(id, 30),
      photo: photosRepo.full(id),
      photoMeta: photosRepo.meta(id)
    }
  })

  handle('items:create', (input: ItemInput) => {
    // Suppliers chosen on the form are linked by itemsRepo.create itself, so adding a
    // part and recording who sells it is one save rather than two trips.
    const result = itemsRepo.create(input)
    notifyChanged('items')
    notifyChanged('suppliers')
    return result
  })

  handle('items:update', (id: string, patch: Partial<ItemInput>) => {
    const item = itemsRepo.update(id, patch)
    notifyChanged('items')
    // Opening stock feeds every derived quantity, and the BOM view shows item names.
    notifyChanged('bom')
    if (patch.suppliers) {
      notifyChanged('suppliers')
      notifyChanged('purchasing')
    }
    return item
  })

  handle('items:setArchived', (id: string, archived: boolean) => {
    const item = itemsRepo.setArchived(id, archived)
    notifyChanged('items')
    return item
  })

  handle('items:remove', (id: string) => {
    const result = itemsRepo.remove(id)
    if (result.ok) notifyChanged('items')
    return result
  })

  /* ---------------------- suppliers for a part ---------------------- */

  handle('items:suppliers', (itemId: string) => itemSuppliersRepo.forItem(itemId))

  handle(
    'items:attachSupplier',
    (
      itemId: string,
      supplierId: string,
      details?: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null; isPreferred?: boolean }
    ) => {
      const result = itemSuppliersRepo.attach(itemId, supplierId, details ?? {})
      if (result.ok) {
        notifyChanged('items')
        notifyChanged('suppliers')
        notifyChanged('purchasing')
      }
      return result
    }
  )

  handle(
    'items:updateSupplierLink',
    (linkId: string, patch: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null; isPreferred?: boolean }) => {
      const result = itemSuppliersRepo.update(linkId, patch)
      if (result.ok) {
        notifyChanged('items')
        notifyChanged('suppliers')
        notifyChanged('purchasing')
      }
      return result
    }
  )

  handle('items:detachSupplier', (linkId: string) => {
    const result = itemSuppliersRepo.detach(linkId)
    if (result.ok) {
      notifyChanged('items')
      notifyChanged('suppliers')
      notifyChanged('purchasing')
    }
    return result
  })

  handle('items:setPreferredSupplier', (itemId: string, supplierId: string) => {
    const result = itemSuppliersRepo.setPreferred(itemId, supplierId)
    if (result.ok) {
      notifyChanged('items')
      notifyChanged('suppliers')
      // Which supplier a shortage is grouped under has just changed.
      notifyChanged('purchasing')
    }
    return result
  })

  /** Creates the supplier and links it in one call, for the inline form. */
  handle(
    'items:createAndAttachSupplier',
    (
      itemId: string,
      supplier: NewSupplierInput,
      details?: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null }
    ) => {
      if (!supplier?.name?.trim()) return { ok: false, supplier: null, error: 'A supplier name is required' }
      // `create` returns the existing row when the name already exists, so typing a
      // known supplier's name inline reuses it instead of making a near-duplicate.
      const created = suppliersRepo.create(supplier as never)
      const linked = itemSuppliersRepo.attach(itemId, created.id, details ?? {})
      if (!linked.ok) return { ok: false, supplier: null, error: linked.error }
      notifyChanged('items')
      notifyChanged('suppliers')
      notifyChanged('purchasing')
      return { ok: true, supplier: created }
    }
  )

  /* ------------------------------ item photo ------------------------------ */

  handle('items:photo', (itemId: string) => photosRepo.full(itemId))

  handle('items:setPhoto', (input: PhotoInput) => {
    // The renderer has already downscaled both copies with a canvas; this side only
    // decodes and stores them.
    const result = photosRepo.set({
      itemId: input.itemId,
      mime: input.mime,
      thumb: Buffer.from(input.thumbBase64, 'base64'),
      full: Buffer.from(input.fullBase64, 'base64'),
      width: input.width,
      height: input.height
    })
    if (result.ok) notifyChanged('items')
    return result
  })

  handle('items:removePhoto', (itemId: string) => {
    const ok = photosRepo.remove(itemId)
    if (ok) notifyChanged('items')
    return ok
  })

  handle('items:exportCsv', async () => {
    const path = await saveAs(exporters.defaultNames.items())
    if (!path) return { path: null }
    exporters.exportItems(path)
    return { path }
  })

  /* ---------------------------------- bom --------------------------------- */

  handle('bom:list', (fgItemId?: string) => bomRepo.list(fgItemId))
  handle('bom:explode', (fgItemId: string, qty: number) => bomRepo.explode(fgItemId, qty))

  handle(
    'bom:addLine',
    (input: { fgItemId: string; rmItemId: string; qtyPerUnit: number; scrapPercent?: number; notes?: string | null }) => {
      const result = bomRepo.addLine(input)
      if (result.ok) notifyChanged('bom')
      return result
    }
  )

  handle('bom:updateLine', (id: string, patch: { qtyPerUnit?: number; scrapPercent?: number; notes?: string | null }) => {
    const result = bomRepo.updateLine(id, patch)
    if (result.ok) notifyChanged('bom')
    return result
  })

  handle('bom:removeLine', (id: string) => {
    const ok = bomRepo.removeLine(id)
    notifyChanged('bom')
    return ok
  })

  handle(
    'bom:replaceFor',
    (fgItemId: string, lines: { rmItemId: string; qtyPerUnit: number; scrapPercent?: number }[]) => {
      const result = bomRepo.replaceFor(fgItemId, lines)
      notifyChanged('bom')
      return result
    }
  )

  handle('bom:copyFrom', (sourceFgItemId: string, targetFgItemId: string) => {
    const result = bomRepo.copyFrom(sourceFgItemId, targetFgItemId)
    notifyChanged('bom')
    return result
  })

  handle('bom:exportCsv', async () => {
    const path = await saveAs(exporters.defaultNames.bom())
    if (!path) return { path: null }
    exporters.exportBom(path)
    return { path }
  })

  /* -------------------------------- orders -------------------------------- */

  handle('orders:list', (query?: OrderQuery) => ordersRepo.list(query ?? {}))
  handle('orders:get', (id: string) => ordersRepo.get(id))
  handle('orders:plan_get', (id: string) => plansRepo.liveWithLines(id))
  handle('orders:planHistory', (id: string) => plansRepo.historyFor(id))
  handle('orders:packing', (id: string) => orderPacking(id))
  handle('orders:weight', (id: string) => weightRollup(id))
  handle('orders:pickList', (id: string) => pickListFor(id))

  handle('orders:create', (input: OrderInput) => {
    const result = ordersRepo.create(input)
    notifyChanged('orders')
    return result
  })

  handle('orders:update', (id: string, patch: Partial<OrderInput>) => {
    const order = ordersRepo.update(id, patch)
    notifyChanged('orders')
    // A quantity change may have superseded the plan, which frees committed stock.
    notifyChanged('plans')
    notifyChanged('items')
    return order
  })

  handle('orders:setStatus', (id: string, status: OrderStatus) => {
    const order = ordersRepo.setStatus(id, status)
    notifyChanged('orders')
    // Closing or cancelling an order drops its commitment, so free stock moves.
    notifyChanged('items')
    notifyChanged('plans')
    return order
  })

  handle('orders:remove', (id: string) => {
    const result = ordersRepo.remove(id)
    if (result.ok) {
      notifyChanged('orders')
      notifyChanged('items')
      notifyChanged('plans')
    }
    return result
  })

  handle('orders:plan', (id: string) => {
    const result = planOrder(id)
    if (result.ok) {
      notifyChanged('plans')
      notifyChanged('orders')
      // Planning creates a commitment, which changes every item's free stock.
      notifyChanged('items')
    }
    return result
  })

  handle('orders:issueMaterial', (id: string, only?: string[]) => {
    const result = issueMaterial(id, only)
    if (result.issued.length) {
      notifyChanged('moves')
      notifyChanged('items')
      notifyChanged('plans')
      notifyChanged('orders')
    }
    return result
  })

  handle('orders:bookProduction', (id: string, qty: number, remarks?: string) => {
    const result = bookProduction(id, qty, remarks)
    if (result.ok) {
      notifyChanged('moves')
      notifyChanged('items')
      notifyChanged('orders')
      notifyChanged('plans')
    }
    return result
  })

  handle('orders:exportPlanCsv', async (id: string) => {
    const order = ordersRepo.get(id)
    if (!order) return { path: null }
    const path = await saveAs(exporters.defaultNames.plan(order.orderNo))
    if (!path) return { path: null }
    exporters.exportPlan(path, id)
    return { path }
  })

  handle('orders:exportPickListCsv', async (id: string) => {
    const order = ordersRepo.get(id)
    if (!order) return { path: null }
    const path = await saveAs(exporters.defaultNames.pickList(order.orderNo))
    if (!path) return { path: null }
    exporters.exportPickList(path, id)
    return { path }
  })

  /* --------------------------------- moves -------------------------------- */

  handle('moves:list', (query?: MoveQuery) => movesRepo.list(query ?? {}))

  handle('moves:create', (input: MoveInput) => {
    const result = movesRepo.create(input)
    if (result.ok) {
      notifyChanged('moves')
      notifyChanged('items')
      // movesRepo keeps the plan's issued figures in step; this is only the refetch.
      if (input.orderId) {
        notifyChanged('plans')
        notifyChanged('orders')
      }
    }
    return result
  })

  handle('moves:createMany', (inputs: MoveInput[]) => {
    const result = movesRepo.createMany(inputs)
    if (result.created) {
      notifyChanged('moves')
      notifyChanged('items')
      notifyChanged('plans')
      notifyChanged('orders')
    }
    return result
  })

  handle('moves:void', (id: string, reason: string) => {
    const move = movesRepo.get(id)
    const result = movesRepo.void(id, reason)
    if (result.ok) {
      notifyChanged('moves')
      notifyChanged('items')
      if (move?.orderId) {
        notifyChanged('plans')
        notifyChanged('orders')
      }
    }
    return result
  })

  handle('moves:exportCsv', async (query?: MoveQuery) => {
    const path = await saveAs(exporters.defaultNames.ledger())
    if (!path) return { path: null }
    exporters.exportLedger(path, query ?? {})
    return { path }
  })

  /* ------------------------------ purchasing ------------------------------ */

  handle('purchasing:suggestions', () => purchaseSuggestions())

  handle('purchasing:exportCsv', async () => {
    const path = await saveAs(exporters.defaultNames.purchasing())
    if (!path) return { path: null }
    exporters.exportPurchasing(path)
    return { path }
  })

  /* ------------------------------- editables ------------------------------ */

  handle('editables:boxes:list', (includeArchived?: boolean) => packingBoxesRepo.list(!!includeArchived))
  handle('editables:boxes:itemsIn', (id: string) => packingBoxesRepo.itemsIn(id))

  handle('editables:boxes:create', (input: Parameters<typeof packingBoxesRepo.create>[0]) => {
    const result = packingBoxesRepo.create(input)
    if (result.ok) {
      notifyChanged('editables')
      notifyChanged('items')
    }
    return result
  })

  handle('editables:boxes:update', (id: string, patch: Parameters<typeof packingBoxesRepo.update>[1]) => {
    const result = packingBoxesRepo.update(id, patch)
    if (result.ok) {
      notifyChanged('editables')
      // The label shows on item rows and packing reports.
      notifyChanged('items')
      notifyChanged('orders')
    }
    return result
  })

  handle('editables:boxes:remove', (id: string) => {
    const result = packingBoxesRepo.remove(id)
    if (result.ok) {
      notifyChanged('editables')
      notifyChanged('items')
    }
    return result
  })

  handle('editables:boxes:reorder', (orderedIds: string[]) => {
    const boxes = packingBoxesRepo.reorder(orderedIds)
    notifyChanged('editables')
    return boxes
  })

  /* ------------------------------- locations ------------------------------ */

  handle('locations:summaries', () => locationSummaries())

  handle('locations:rename', (from: string, to: string) => {
    const target = to.trim()
    if (!target) return { ok: false, affected: 0, error: 'Give the new location a name' }
    const affected = run('UPDATE items SET location = ?, updated_at = ? WHERE location = ?', [
      target,
      Date.now(),
      from
    ]).changes
    notifyChanged('items')
    return { ok: true, affected }
  })

  /* ------------------------------- dashboard ------------------------------ */

  handle('dashboard:stats', () => statsRepo.dashboard())

  /* --------------------------------- backup ------------------------------- */

  handle('backup:list', () => listBackups(ctx.userDataPath))
  handle('backup:create', () => createBackup(ctx.userDataPath, 'manual'))
  handle('backup:revealFolder', () => {
    shell.openPath(join(ctx.userDataPath, 'backups'))
  })

  handle('backup:restore', async (path: string) => {
    const staged = stageRestore(path)
    if (!staged.ok) return staged
    const win = focusedWindow()
    const choice = await dialog.showMessageBox(win ?? undefined!, {
      type: 'warning',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      title: 'Restore backup',
      message: 'StockFlow needs to restart to finish restoring this backup.',
      detail: 'Your current data will be replaced by the backup when the app restarts.'
    })
    if (choice.response === 0) {
      app.relaunch()
      app.exit(0)
    }
    return { ok: true }
  })

  handle('backup:exportJson', async () => {
    const path = await saveAs(`stockflow-export-${new Date().toISOString().slice(0, 10)}.json`, 'json')
    if (!path) return { path: null }
    exporters.exportJson(path, app.getVersion())
    return { path }
  })

  log.info('ipc', 'handlers registered')
}
