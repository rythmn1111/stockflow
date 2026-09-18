import { contextBridge, ipcRenderer } from 'electron'
import type { StockFlowApi } from '@shared/api'

/**
 * The only bridge between the renderer and Node. Every method is an explicit, named
 * channel — the renderer can never reach `ipcRenderer` or `require` directly.
 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

const api: StockFlowApi & { theme: { set: (theme: 'light' | 'dark' | 'system') => void } } = {
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    showItemInFolder: (path) => invoke('app:showItemInFolder', path),
    revealLogs: () => invoke('app:revealLogs'),
    relaunch: () => invoke('app:relaunch')
  },

  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    completeOnboarding: (payload) => invoke('settings:completeOnboarding', payload)
  },

  suppliers: {
    list: (search) => invoke('suppliers:list', search),
    get: (id) => invoke('suppliers:get', id),
    create: (input) => invoke('suppliers:create', input),
    update: (id, patch) => invoke('suppliers:update', id, patch),
    remove: (id) => invoke('suppliers:remove', id),
    itemCount: (id) => invoke('suppliers:itemCount', id)
  },

  items: {
    list: (query) => invoke('items:list', query),
    detail: (id) => invoke('items:detail', id),
    get: (id) => invoke('items:get', id),
    byCode: (code) => invoke('items:byCode', code),
    create: (input) => invoke('items:create', input),
    update: (id, patch) => invoke('items:update', id, patch),
    setArchived: (id, archived) => invoke('items:setArchived', id, archived),
    remove: (id) => invoke('items:remove', id),
    locations: () => invoke('items:locations'),
    units: () => invoke('items:units'),
    stockAsOf: (at) => invoke('items:stockAsOf', at),
    exportCsv: () => invoke('items:exportCsv')
  },

  bom: {
    list: (fgItemId) => invoke('bom:list', fgItemId),
    explode: (fgItemId, qty) => invoke('bom:explode', fgItemId, qty),
    addLine: (input) => invoke('bom:addLine', input),
    updateLine: (id, patch) => invoke('bom:updateLine', id, patch),
    removeLine: (id) => invoke('bom:removeLine', id),
    replaceFor: (fgItemId, lines) => invoke('bom:replaceFor', fgItemId, lines),
    copyFrom: (sourceFgItemId, targetFgItemId) => invoke('bom:copyFrom', sourceFgItemId, targetFgItemId),
    exportCsv: () => invoke('bom:exportCsv')
  },

  orders: {
    list: (query) => invoke('orders:list', query),
    get: (id) => invoke('orders:get', id),
    create: (input) => invoke('orders:create', input),
    update: (id, patch) => invoke('orders:update', id, patch),
    setStatus: (id, status) => invoke('orders:setStatus', id, status),
    remove: (id) => invoke('orders:remove', id),
    plan: (id) => invoke('orders:plan', id),
    plan_get: (id) => invoke('orders:plan_get', id),
    planHistory: (id) => invoke('orders:planHistory', id),
    issueMaterial: (id, only) => invoke('orders:issueMaterial', id, only),
    bookProduction: (id, qty, remarks) => invoke('orders:bookProduction', id, qty, remarks),
    exportPlanCsv: (id) => invoke('orders:exportPlanCsv', id),
    packing: (id) => invoke('orders:packing', id),
    weight: (id) => invoke('orders:weight', id),
    pickList: (id) => invoke('orders:pickList', id),
    exportPickListCsv: (id) => invoke('orders:exportPickListCsv', id)
  },

  moves: {
    list: (query) => invoke('moves:list', query),
    create: (input) => invoke('moves:create', input),
    createMany: (inputs) => invoke('moves:createMany', inputs),
    void: (id, reason) => invoke('moves:void', id, reason),
    exportCsv: (query) => invoke('moves:exportCsv', query)
  },

  purchasing: {
    suggestions: () => invoke('purchasing:suggestions'),
    exportCsv: () => invoke('purchasing:exportCsv')
  },

  locations: {
    summaries: () => invoke('locations:summaries'),
    rename: (from, to) => invoke('locations:rename', from, to)
  },

  dashboard: {
    stats: () => invoke('dashboard:stats')
  },

  backup: {
    list: () => invoke('backup:list'),
    create: () => invoke('backup:create'),
    restore: (path) => invoke('backup:restore', path),
    exportJson: () => invoke('backup:exportJson'),
    revealFolder: () => invoke('backup:revealFolder')
  },

  on: {
    dataChanged: (cb) => subscribe('data:changed', cb),
    navigate: (cb) => subscribe('nav:goto', cb)
  },

  theme: {
    set: (theme) => ipcRenderer.send('theme:set', theme)
  }
}

contextBridge.exposeInMainWorld('api', api)
