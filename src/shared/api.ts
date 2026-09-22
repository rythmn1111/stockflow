import type {
  AppSettings,
  BomLineWithItems,
  DashboardStats,
  Item,
  ItemQuery,
  ItemType,
  ItemPhotoMeta,
  ItemSupplierLinkWithSupplier,
  ItemWithStock,
  LocationSummary,
  MoveQuery,
  MoveReason,
  Order,
  OrderQuery,
  OrderStatus,
  OrderPacking,
  OrderWithItem,
  PackingBox,
  PickList,
  PlanWithLines,
  PurchaseSuggestion,
  StockAsOf,
  StockMoveWithItem,
  Supplier,
  SupplierDetail,
  WeightRollup
} from './types'

export interface AppInfo {
  version: string
  platform: string
  userDataPath: string
  dbPath: string
  logPath: string | null
  isPackaged: boolean
}

export interface BackupInfo {
  path: string
  createdAt: number
  sizeBytes: number
}

export interface DataChangedEvent {
  scope: 'items' | 'suppliers' | 'bom' | 'orders' | 'moves' | 'plans' | 'purchasing' | 'editables' | 'settings' | 'all'
}

export type NavPage =
  | 'dashboard'
  | 'items'
  | 'suppliers'
  | 'bom'
  | 'orders'
  | 'ledger'
  | 'purchasing'
  | 'locations'
  | 'editables'
  | 'settings'
  | 'new-item'
  | 'new-move'
  | 'new-order'
  | 'palette'
  | 'search'

export type NavEvent =
  | { page: 'item'; itemId: string }
  | { page: 'order'; orderId: string }
  | { page: NavPage }

export interface ItemInput {
  code: string
  name: string
  unit?: string
  type: ItemType
  openingStock?: number
  reorderLevel?: number
  netWeight?: number | null
  grossWeight?: number | null
  packingBoxId?: string | null
  quantityPacked?: number | null
  location?: string | null
  rack?: string | null
  notes?: string | null
  /**
   * Suppliers to link on create, so the item form can capture them in one save rather
   * than making the user create the item and then come back for its sources.
   */
  suppliers?: {
    supplierId: string
    isPreferred?: boolean
    supplierSku?: string | null
    unitPrice?: number | null
    leadTimeDays?: number | null
  }[]
}

/** A supplier created inline from the item form, before it has an id. */
export interface NewSupplierInput {
  name: string
  contact?: string | null
  phone?: string | null
  email?: string | null
  leadTimeDays?: number | null
}

/** A downscaled image on its way in from the renderer. */
export interface PhotoInput {
  itemId: string
  mime: string
  /** Base64 (no data-URL prefix) of the small list thumbnail. */
  thumbBase64: string
  /** Base64 of the bounded display copy. */
  fullBase64: string
  width?: number | null
  height?: number | null
}

export interface MoveInput {
  itemId: string
  direction: 'in' | 'out'
  qty: number
  movedAt?: number
  reason?: MoveReason
  referenceNo?: string | null
  orderId?: string | null
  remarks?: string | null
}

export interface OrderInput {
  orderNo: string
  orderDate: number
  fgItemId: string
  qtyOrdered: number
  status?: OrderStatus
  customer?: string | null
  dueDate?: number | null
  notes?: string | null
}

export interface ItemDetail {
  item: ItemWithStock
  /** Every supplier for this part, preferred first. */
  suppliers: ItemSupplierLinkWithSupplier[]
  /** BOM lines where this item is the parent. Empty for a raw material. */
  componentsOf: BomLineWithItems[]
  /** BOM lines where this item is the component — what it feeds into. */
  usedIn: BomLineWithItems[]
  recentMoves: StockMoveWithItem[]
  /** Open orders holding a commitment against this item. */
  commitments: { orderId: string; orderNo: string; qty: number; dueDate: number | null }[]
  /** 30 days of running balance for the item's sparkline. */
  balanceHistory: { date: string; balance: number }[]
  /** The display copy as a data URL, fetched only for the detail view. */
  photo: string | null
  photoMeta: ItemPhotoMeta | null
}

export interface IssueResult {
  ok: boolean
  issued: { itemId: string; code: string; qty: number }[]
  /** Lines that could not be fully issued because free stock ran out. */
  short: { itemId: string; code: string; wanted: number; issued: number }[]
  error?: string
}

/** The contract exposed on `window.api`. Every method crosses the IPC bridge. */
export interface StockFlowApi {
  app: {
    info: () => Promise<AppInfo>
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (path: string) => Promise<void>
    revealLogs: () => Promise<void>
    relaunch: () => Promise<void>
  }

  settings: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<AppSettings>
    completeOnboarding: (payload: { companyName?: string; defaultUnit?: string }) => Promise<AppSettings>
  }

  suppliers: {
    list: (search?: string) => Promise<Supplier[]>
    get: (id: string) => Promise<Supplier | null>
    create: (input: Partial<Supplier> & { name: string }) => Promise<Supplier>
    update: (id: string, patch: Partial<Supplier>) => Promise<Supplier | null>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    /** Items sourced from this supplier, for the delete confirmation. */
    itemCount: (id: string) => Promise<number>
    /** The supplier card: their parts, what they are holding up, recent receipts. */
    detail: (id: string) => Promise<SupplierDetail | null>
    exportPartsCsv: (id: string) => Promise<{ path: string | null }>
  }

  items: {
    list: (query?: ItemQuery) => Promise<{ items: ItemWithStock[]; total: number }>
    detail: (id: string) => Promise<ItemDetail | null>
    get: (id: string) => Promise<ItemWithStock | null>
    byCode: (code: string) => Promise<ItemWithStock | null>
    create: (input: ItemInput) => Promise<{ item: Item; duplicate: boolean }>
    update: (id: string, patch: Partial<ItemInput>) => Promise<Item | null>
    setArchived: (id: string, archived: boolean) => Promise<Item | null>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    locations: () => Promise<string[]>
    racks: () => Promise<string[]>
    units: () => Promise<string[]>

    /* --- suppliers for a part --- */
    suppliers: (itemId: string) => Promise<ItemSupplierLinkWithSupplier[]>
    attachSupplier: (
      itemId: string,
      supplierId: string,
      details?: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null; isPreferred?: boolean }
    ) => Promise<{ ok: boolean; error?: string }>
    updateSupplierLink: (
      linkId: string,
      patch: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null; isPreferred?: boolean }
    ) => Promise<{ ok: boolean; error?: string }>
    detachSupplier: (linkId: string) => Promise<{ ok: boolean; error?: string }>
    setPreferredSupplier: (itemId: string, supplierId: string) => Promise<{ ok: boolean; error?: string }>
    /** Creates a supplier and links it to the part in one step, for the item form. */
    createAndAttachSupplier: (
      itemId: string,
      supplier: NewSupplierInput,
      details?: { supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null }
    ) => Promise<{ ok: boolean; supplier: Supplier | null; error?: string }>

    /* --- photo --- */
    photo: (itemId: string) => Promise<string | null>
    setPhoto: (input: PhotoInput) => Promise<{ ok: boolean; error?: string }>
    removePhoto: (itemId: string) => Promise<boolean>
    /** Every item's balance at a chosen instant, from the ledger. */
    stockAsOf: (at: number) => Promise<StockAsOf[]>
    exportCsv: () => Promise<{ path: string | null }>
  }

  bom: {
    list: (fgItemId?: string) => Promise<BomLineWithItems[]>
    /** Full recursive explosion of one finished good, with cycle detection. */
    explode: (
      fgItemId: string,
      qty: number
    ) => Promise<{
      lines: { itemId: string; code: string; name: string; unit: string; qty: number; depth: number }[]
      cycle: string[] | null
    }>
    addLine: (input: {
      fgItemId: string
      rmItemId: string
      qtyPerUnit: number
      scrapPercent?: number
      notes?: string | null
    }) => Promise<{ ok: boolean; error?: string }>
    updateLine: (
      id: string,
      patch: { qtyPerUnit?: number; scrapPercent?: number; notes?: string | null }
    ) => Promise<{ ok: boolean; error?: string }>
    removeLine: (id: string) => Promise<boolean>
    /** Replaces a finished good's whole component list in one transaction. */
    replaceFor: (
      fgItemId: string,
      lines: { rmItemId: string; qtyPerUnit: number; scrapPercent?: number }[]
    ) => Promise<{ ok: boolean; error?: string }>
    copyFrom: (sourceFgItemId: string, targetFgItemId: string) => Promise<{ ok: boolean; copied: number; error?: string }>
    exportCsv: () => Promise<{ path: string | null }>
  }

  orders: {
    list: (query?: OrderQuery) => Promise<{ items: OrderWithItem[]; total: number }>
    get: (id: string) => Promise<OrderWithItem | null>
    create: (input: OrderInput) => Promise<{ order: Order; duplicate: boolean }>
    update: (id: string, patch: Partial<OrderInput>) => Promise<Order | null>
    setStatus: (id: string, status: OrderStatus) => Promise<Order | null>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    /** Runs material planning and saves the result. Supersedes the previous plan. */
    plan: (id: string) => Promise<{ ok: boolean; plan: PlanWithLines | null; error?: string }>
    /** The live plan for an order, if any. */
    plan_get: (id: string) => Promise<PlanWithLines | null>
    /** Every plan ever run for this order, newest first. */
    planHistory: (id: string) => Promise<PlanWithLines[]>
    /** Creates OUTWARD moves for everything the plan can currently cover. */
    issueMaterial: (id: string, only?: string[]) => Promise<IssueResult>
    /** Books finished units into stock and consumes nothing further. */
    bookProduction: (id: string, qty: number, remarks?: string) => Promise<{ ok: boolean; error?: string }>
    exportPlanCsv: (id: string) => Promise<{ path: string | null }>
    /** Cartons and shipping weight, from the finished good's packing fields. */
    packing: (id: string) => Promise<OrderPacking | null>
    /** Finished-goods weight against exploded material weight. */
    weight: (id: string) => Promise<WeightRollup | null>
    /** The live plan reordered into a walking route through the store. */
    pickList: (id: string) => Promise<PickList | null>
    exportPickListCsv: (id: string) => Promise<{ path: string | null }>
  }

  moves: {
    list: (query?: MoveQuery) => Promise<{ items: StockMoveWithItem[]; total: number }>
    create: (input: MoveInput) => Promise<{ ok: boolean; move: StockMoveWithItem | null; error?: string; warning?: string }>
    /** Several moves in one transaction — all land or none do. */
    createMany: (inputs: MoveInput[]) => Promise<{ ok: boolean; created: number; error?: string }>
    void: (id: string, reason: string) => Promise<{ ok: boolean; error?: string }>
    exportCsv: (query?: MoveQuery) => Promise<{ path: string | null }>
  }

  purchasing: {
    /** Shortages across every live plan, grouped by supplier. */
    suggestions: () => Promise<PurchaseSuggestion[]>
    exportCsv: () => Promise<{ path: string | null }>
  }

  /**
   * Editable lists that feed dropdowns elsewhere in the app. Packing boxes are the
   * first; each list gets typed fields rather than being a bag of strings.
   */
  editables: {
    packingBoxes: {
      list: (includeArchived?: boolean) => Promise<PackingBox[]>
      create: (input: {
        label: string
        lengthMm?: number | null
        widthMm?: number | null
        heightMm?: number | null
        emptyWeight?: number | null
        notes?: string | null
      }) => Promise<{ ok: boolean; box: PackingBox | null; error?: string }>
      update: (
        id: string,
        patch: {
          label?: string
          lengthMm?: number | null
          widthMm?: number | null
          heightMm?: number | null
          emptyWeight?: number | null
          notes?: string | null
          archived?: boolean
        }
      ) => Promise<{ ok: boolean; error?: string }>
      remove: (id: string) => Promise<{ ok: boolean; error?: string }>
      reorder: (orderedIds: string[]) => Promise<PackingBox[]>
      /** Items packed in one box, for the editables screen. */
      itemsIn: (id: string) => Promise<{ id: string; code: string; name: string; quantityPacked: number | null }[]>
    }
  }

  locations: {
    /** Stock rolled up by shelf, for stock-taking. */
    summaries: () => Promise<LocationSummary[]>
    /** Moves every item at one location to another, for a shelf reshuffle. */
    rename: (from: string, to: string) => Promise<{ ok: boolean; affected: number; error?: string }>
  }

  dashboard: {
    stats: () => Promise<DashboardStats>
  }

  backup: {
    list: () => Promise<BackupInfo[]>
    create: () => Promise<BackupInfo | null>
    restore: (path: string) => Promise<{ ok: boolean; error?: string }>
    exportJson: () => Promise<{ path: string | null }>
    revealFolder: () => Promise<void>
  }

  on: {
    dataChanged: (cb: (event: DataChangedEvent) => void) => () => void
    navigate: (cb: (event: NavEvent) => void) => () => void
  }
}
