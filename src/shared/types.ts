/**
 * The domain, translated from `Stock Register System.xlsm`.
 *
 * Two structural changes from the workbook, both deliberate:
 *
 *  1. Current stock is never stored. The workbook kept a `Stock_Register` sheet whose
 *     item list duplicated `Item_Master` and whose quantities were full-column SUMIFS.
 *     Here the move ledger is the only truth and stock is derived on read.
 *  2. Supplier name and contact were two columns on every item row. They are their own
 *     table now, so correcting a phone number is one edit rather than many.
 */

/**
 * What kind of thing an item is. The workbook had only RM and FG in a column called
 * `Item_Type (RM/FG)`; the rest are the categories a real store actually holds.
 *
 * Type is not just a label — it decides what an item can take part in. See
 * `ORDERABLE_TYPES` and `BOM_PARENT_TYPES`.
 */
export type ItemType = 'RM' | 'WIP' | 'FG' | 'BOUGHT_OUT' | 'CONSUMABLE' | 'ASSET'

/** Ordered for display: roughly the path material takes through the building. */
export const ITEM_TYPES: { value: ItemType; label: string; short: string; hint: string }[] = [
  { value: 'RM', label: 'Raw material', short: 'RM', hint: 'Bought in and consumed to make something' },
  { value: 'WIP', label: 'Work in progress', short: 'WIP', hint: 'A sub-assembly: made here, then used in something else' },
  { value: 'FG', label: 'Finished good', short: 'FG', hint: 'Made here and sold' },
  { value: 'BOUGHT_OUT', label: 'Bought out', short: 'BO', hint: 'Bought finished and resold without being made' },
  { value: 'CONSUMABLE', label: 'Consumable', short: 'CONS', hint: 'Used up in production but not part of the product' },
  { value: 'ASSET', label: 'Asset', short: 'ASSET', hint: 'Tooling or equipment that is held, not consumed' }
]

/** Types a customer order can be raised against — things you sell or produce. */
export const ORDERABLE_TYPES: ItemType[] = ['FG', 'WIP', 'BOUGHT_OUT']

/** Types that can have a bill of materials — things made rather than bought. */
export const BOM_PARENT_TYPES: ItemType[] = ['FG', 'WIP']

/** Ledger direction. The workbook used the strings INWARD / OUTWARD. */
export type MoveDirection = 'in' | 'out'

/**
 * Why stock moved. The workbook had only a free-text `Remarks` column, so a receipt and
 * a correction were indistinguishable. Categorising them lets the ledger explain itself
 * and lets consumption be separated from purchases in reporting.
 */
export type MoveReason =
  | 'purchase' // goods received from a supplier
  | 'issue' // raw material issued to an order
  | 'production' // finished goods produced and taken into stock
  | 'sale' // finished goods dispatched
  | 'return' // sent back to the supplier, or returned from the floor
  | 'adjustment' // stock-take correction
  | 'opening' // migrated opening balance
  | 'other'

export type OrderStatus = 'draft' | 'planned' | 'in_production' | 'completed' | 'cancelled'

export interface Supplier {
  id: string
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  /** Typical days between placing an order and receiving it; drives "order by" dates. */
  leadTimeDays: number | null
  notes: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

/**
 * A box size on the app's editable list. The workbook had `Packing Box Details` as
 * free text per item, so the same carton existed under several spellings.
 */
export interface PackingBox {
  id: string
  label: string
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  /** The empty box's own weight — part of what actually ships. */
  emptyWeight: number | null
  notes: string | null
  sortIndex: number
  archivedAt: number | null
  /** How many items are packed in this box; blocks deleting one that is in use. */
  itemCount: number
  createdAt: number
  updatedAt: number
}

export interface Item {
  id: string
  code: string
  name: string
  unit: string
  type: ItemType
  /** Balance carried in at migration time. The ledger accumulates on top of this. */
  openingStock: number
  reorderLevel: number
  netWeight: number | null
  grossWeight: number | null
  /** Chosen from the editable box list rather than typed. */
  packingBoxId: string | null
  quantityPacked: number | null
  location: string | null
  /** The shelf or rack within `location`. Pick lists walk location, then rack. */
  rack: string | null
  notes: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

/** An item with everything the stock screens need, computed from the ledger. */
export interface ItemWithStock extends Item {
  /** The preferred supplier's name, or null when the item has no suppliers. */
  supplierName: string | null
  preferredSupplierId: string | null
  /** How many suppliers can provide this part. */
  supplierCount: number
  /** True when a photo has been attached; the bytes are fetched separately. */
  hasPhoto: boolean
  /** Small inline thumbnail (data URL) for list rows, when one exists. */
  photoThumb: string | null
  /** The chosen box's name, joined for display. */
  packingBoxLabel: string | null
  /** The chosen box's own weight, which shipping weight has to include. */
  packingBoxEmptyWeight: number | null
  totalInward: number
  totalOutward: number
  /** openingStock + totalInward − totalOutward. */
  currentStock: number
  /**
   * Quantity promised to open orders by live plans and not yet issued, summed across
   * every such plan. It can exceed what is on the shelf — that is what a shortage is.
   */
  committed: number
  /**
   * currentStock − committed: what a new order can actually count on. Goes negative
   * when open orders have been promised more than exists, and the magnitude is then
   * the aggregate shortage, which is exactly what the purchase list is built from.
   */
  freeStock: number
  belowReorder: boolean
  /** Number of distinct finished goods whose BOM references this item. */
  usedInBomCount: number
  lastMovedAt: number | null
}

/* ------------------------- item ↔ supplier links -------------------------- */

/**
 * One supplier's offer for one part. The workbook put a single supplier name and
 * contact on every item row, so a part could only ever have one source and a changed
 * phone number meant editing many rows.
 *
 * The per-vendor fields are the reason to hold more than one: they are what you compare.
 */
export interface ItemSupplierLink {
  id: string
  itemId: string
  supplierId: string
  /**
   * Exactly one link per item carries this. It decides which supplier a shortage is
   * grouped under in Purchasing — spreading one shortage across every possible supplier
   * would multiply the quantity to buy.
   */
  isPreferred: boolean
  /** This supplier's own part number, which is what goes on their purchase order. */
  supplierSku: string | null
  unitPrice: number | null
  /** Overrides the supplier's default lead time for this part only. */
  leadTimeDays: number | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

/** A link with the supplier's own details filled in, for the item screens. */
export interface ItemSupplierLinkWithSupplier extends ItemSupplierLink {
  supplierName: string
  supplierContact: string | null
  supplierPhone: string | null
  supplierEmail: string | null
  /** leadTimeDays if set on the link, otherwise the supplier's default. */
  effectiveLeadTimeDays: number | null
}

/** A link with the item's details filled in, for the supplier card. */
export interface ItemSupplierLinkWithItem extends ItemSupplierLink {
  code: string
  name: string
  unit: string
  type: ItemType
  currentStock: number
  freeStock: number
  reorderLevel: number
  belowReorder: boolean
  location: string | null
  rack: string | null
  /** True when this supplier is the preferred source for the part. */
  isPreferredSource: boolean
  /** leadTimeDays if set on the link, otherwise the supplier's default. */
  effectiveLeadTimeDays: number | null
}

/**
 * Everything about one supplier, for the card that opens when you click them.
 * Answers the question the workbook could not: which parts does this supplier give us,
 * and what are they currently holding up?
 */
export interface SupplierDetail {
  supplier: Supplier
  /** Every part this supplier can provide. */
  parts: ItemSupplierLinkWithItem[]
  /** Parts where this supplier is the preferred source. */
  preferredCount: number
  /** Parts currently at or below their reorder level. */
  belowReorderCount: number
  /** Open shortages this supplier is the preferred source for. */
  outstanding: {
    itemId: string
    code: string
    name: string
    unit: string
    shortage: number
    orderNos: string[]
    orderByDate: number | null
  }[]
  /** Sum of unitPrice × shortage across `outstanding`, where a price is known. */
  outstandingValue: number | null
  /** Recent receipts from this supplier, newest first. */
  recentReceipts: { id: string; movedAt: number; code: string; name: string; qty: number; unit: string; referenceNo: string | null }[]
}

/** Photo metadata, without the bytes. */
export interface ItemPhotoMeta {
  itemId: string
  mime: string
  width: number | null
  height: number | null
  bytes: number
  createdAt: number
}

export interface BomLine {
  id: string
  fgItemId: string
  rmItemId: string
  /** Quantity of the component consumed per one unit of the parent. */
  qtyPerUnit: number
  /** Expected wastage, applied on top of qtyPerUnit when exploding. 0–100. */
  scrapPercent: number
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface BomLineWithItems extends BomLine {
  fgCode: string
  fgName: string
  rmCode: string
  rmName: string
  rmUnit: string
  rmType: ItemType
  supplierName: string | null
}

export interface Order {
  id: string
  orderNo: string
  orderDate: number
  fgItemId: string
  qtyOrdered: number
  status: OrderStatus
  customer: string | null
  dueDate: number | null
  notes: string | null
  createdAt: number
  updatedAt: number
}

export interface OrderWithItem extends Order {
  fgCode: string
  fgName: string
  fgUnit: string
  /** Latest plan for this order, if one has been run. */
  latestPlanId: string | null
  latestPlanAt: number | null
  /** Lines on the latest plan still short of stock. */
  shortageLines: number
  /** Raw material already issued against this order. */
  issuedLines: number
  /** Finished units booked into stock against this order. */
  producedQty: number
}

export interface StockMove {
  id: string
  movedAt: number
  direction: MoveDirection
  itemId: string
  /** Always positive. Direction carries the sign. */
  qty: number
  reason: MoveReason
  referenceNo: string | null
  orderId: string | null
  remarks: string | null
  /**
   * Moves are voided, never deleted, so the ledger stays an audit trail. A voided move
   * is excluded from every stock calculation but remains visible with its reason.
   */
  voidedAt: number | null
  voidedReason: string | null
  createdAt: number
}

export interface StockMoveWithItem extends StockMove {
  itemCode: string
  itemName: string
  itemUnit: string
  orderNo: string | null
}

/**
 * A saved material plan. The workbook's macro cleared the planning sheet on every run,
 * so only one order's plan could exist at a time; here every run is kept and tied to
 * its order, which is what makes commitment tracking possible at all.
 */
export interface Plan {
  id: string
  orderId: string
  createdAt: number
  note: string | null
  /** Sum of `shortage` across lines at the moment the plan was computed. */
  totalShortage: number
  lineCount: number
  /** Cleared when a newer plan supersedes this one; only the live plan commits stock. */
  supersededAt: number | null
}

export interface PlanLine {
  id: string
  planId: string
  rmItemId: string
  /** BOM quantity × order quantity, scrap included, summed across BOM paths. */
  qtyRequired: number
  /** Free stock at plan time: on hand minus other open orders' commitments. */
  stockAvailable: number
  /** max(0, qtyRequired − stockAvailable). */
  shortage: number
  /** Already issued to this order when the plan ran, so re-planning is idempotent. */
  alreadyIssued: number
  /** How deep in the BOM tree this component sits. 1 = direct child of the FG. */
  depth: number
  supplierId: string | null
}

export interface PlanLineWithItems extends PlanLine {
  rmCode: string
  rmName: string
  rmUnit: string
  rmType: ItemType
  supplierName: string | null
  supplierContact: string | null
  supplierPhone: string | null
  supplierLeadTimeDays: number | null
  /** Live free stock, so a stored plan can be compared against the present. */
  currentFreeStock: number
}

export interface PlanWithLines extends Plan {
  order: OrderWithItem
  lines: PlanLineWithItems[]
}

/** One supplier's slice of the shortages across every open plan. */
export interface PurchaseSuggestion {
  supplierId: string | null
  supplierName: string
  supplierContact: string | null
  supplierPhone: string | null
  leadTimeDays: number | null
  lines: {
    itemId: string
    code: string
    name: string
    unit: string
    shortage: number
    /** Orders driving this shortage, newest first. */
    orders: { orderId: string; orderNo: string; qty: number; dueDate: number | null }[]
    /** Earliest order due date across the drivers, minus the supplier's lead time. */
    orderByDate: number | null
  }[]
  totalLines: number
}

export interface DashboardStats {
  itemCount: number
  /** One entry per type that has at least one item, in ITEM_TYPES order. */
  byType: { type: ItemType; label: string; count: number }[]
  supplierCount: number
  /** Items nobody is recorded as selling — they can never reach a purchase list. */
  itemsWithoutSupplier: number
  /** Parts with more than one source, which is what makes a fallback possible. */
  itemsWithAlternateSuppliers: number
  /** Items at or below their reorder level, free stock basis. */
  belowReorderCount: number
  /** Items the ledger has driven negative — impossible in reality, so worth surfacing. */
  negativeStockCount: number
  /** Items with no reorder level set, so they can never raise an alert. */
  noReorderLevelCount: number
  openOrderCount: number
  ordersWithShortage: number
  totalShortageLines: number
  movesThisWeek: number
  /** Items in the master that no BOM references and that have never moved. */
  orphanItemCount: number
  /** 14-day inward/outward line counts for the dashboard chart. */
  activityByDay: { date: string; inward: number; outward: number }[]
  topShortages: { code: string; name: string; unit: string; shortage: number; orderNo: string }[]
  reorderList: { code: string; name: string; unit: string; freeStock: number; reorderLevel: number }[]
}

export interface AppSettings {
  companyName: string | null
  /** Shown on exports and the window title. */
  companyAddress: string | null
  defaultUnit: string
  /** Blocks the save that would drive an item's stock below zero. */
  blockNegativeStock: boolean
  /** Warn, but allow, when issuing more than free stock. */
  warnOnOverIssue: boolean
  /** Applied to every BOM line that has no scrap of its own. */
  defaultScrapPercent: number
  /** How many days of ledger the Ledger page shows before you ask for more. */
  ledgerWindowDays: number
  autoBackupEnabled: boolean
  backupRetentionDays: number
  theme: 'light' | 'dark' | 'system'
  onboardingCompletedAt: number | null
}

export interface ItemQuery {
  search?: string
  /** Single type, kept for convenience. `types` wins when both are given. */
  type?: ItemType | 'all'
  /** Several types at once, which is what the six-way type filter needs. */
  types?: ItemType[]
  /** Matches any linked supplier, not only the preferred one. */
  supplierIds?: string[]
  locations?: string[]
  racks?: string[]
  hasPhoto?: boolean
  /** Items nobody is recorded as selling — they cannot appear on a purchase list. */
  noSupplier?: boolean
  /** Narrow to a stock condition rather than making the user eyeball the list. */
  stockFilter?: 'all' | 'below_reorder' | 'negative' | 'zero' | 'in_stock' | 'no_reorder_level'
  scope?: 'active' | 'archived' | 'all'
  sort?: 'code' | 'name' | 'stock_asc' | 'stock_desc' | 'shortfall' | 'recent' | 'location'
  limit?: number
  offset?: number
}

export interface MoveQuery {
  search?: string
  itemId?: string
  orderId?: string
  direction?: MoveDirection | 'all'
  reasons?: MoveReason[]
  from?: number
  to?: number
  includeVoided?: boolean
  limit?: number
  offset?: number
}

export interface OrderQuery {
  search?: string
  statuses?: OrderStatus[]
  sort?: 'recent' | 'order_no' | 'due' | 'shortage'
  limit?: number
  offset?: number
}


/* ------------------------- packing and weight ---------------------------- */

/**
 * The workbook carried `Quantity Packed`, `Packing Box Details`, `Net Weight` and
 * `Gross Weight` as columns nothing ever read. They answer real questions — how many
 * cartons is this order, and what will the lorry weigh — so they are computed here.
 */
export interface PackingBreakdown {
  itemId: string
  code: string
  name: string
  unit: string
  qty: number
  /** Units that fit in one box, from the item's `Quantity Packed` field. */
  unitsPerBox: number | null
  boxDetails: string | null
  /** The box's own weight × number of boxes, when the box list records one. */
  boxesWeight: number | null
  fullBoxes: number
  /** Units left over after filling whole boxes. */
  loose: number
  /** Boxes needed including a part-filled one. Null when units-per-box is unknown. */
  totalBoxes: number | null
  netWeightPerUnit: number | null
  grossWeightPerUnit: number | null
  /** What the packaging itself adds per unit: gross − net. */
  packagingWeightPerUnit: number | null
  totalNetWeight: number | null
  totalGrossWeight: number | null
}

export interface OrderPacking {
  orderId: string
  orderNo: string
  customer: string | null
  finished: PackingBreakdown
  /** Fields the item is missing, so a partial answer never looks complete. */
  gaps: string[]
}

/**
 * Weight of an order seen from both ends: what ships out, and what has to be moved
 * off the shelf to build it. Useful for freight, and for spotting a BOM whose
 * component weights do not add up to the finished good.
 */
export interface WeightRollup {
  orderId: string
  orderNo: string
  finishedNet: number | null
  finishedGross: number | null
  materialNet: number | null
  materialGross: number | null
  /** Components with no weight recorded, so the totals are known to be partial. */
  missingWeightCodes: string[]
  /** materialNet − finishedNet: positive means material is heavier than the product. */
  netDifference: number | null
}

/* ------------------------------- picking -------------------------------- */

export interface PickListLine {
  itemId: string
  code: string
  name: string
  unit: string
  location: string | null
  /** The rack within the location; the walk is ordered by it. */
  rack: string | null
  qtyToPick: number
  onHand: number
  /** How much of qtyToPick the shelf cannot cover right now. */
  shortfall: number
}

/**
 * A plan reordered for the person who actually walks the store. The workbook had a
 * `Location` column but listed material in BOM order, which sends the storeman back
 * and forth across the floor.
 */
export interface PickList {
  orderId: string
  orderNo: string
  fgCode: string
  fgName: string
  qtyOrdered: number
  /** One stop per location, in shelf order. */
  stops: { location: string; lines: PickListLine[]; lineCount: number }[]
  /** Lines whose item has no location set — they slow every pick down. */
  unlocated: PickListLine[]
  totalLines: number
  shortfallLines: number
}

export interface LocationSummary {
  location: string
  itemCount: number
  /** Distinct items at or below reorder level in this location. */
  belowReorderCount: number
  totalUnits: number
  totalNetWeight: number | null
}

export interface StockAsOf {
  itemId: string
  code: string
  name: string
  unit: string
  stock: number
}
