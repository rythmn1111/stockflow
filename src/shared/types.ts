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

/** Raw material or finished good. The workbook called this `Item_Type (RM/FG)`. */
export type ItemType = 'RM' | 'FG'

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
  packingBoxDetails: string | null
  quantityPacked: number | null
  location: string | null
  supplierId: string | null
  notes: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

/** An item with everything the stock screens need, computed from the ledger. */
export interface ItemWithStock extends Item {
  supplierName: string | null
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
  rmCount: number
  fgCount: number
  supplierCount: number
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
  type?: ItemType | 'all'
  supplierIds?: string[]
  locations?: string[]
  /** Narrow to a stock condition rather than making the user eyeball the list. */
  stockFilter?: 'all' | 'below_reorder' | 'negative' | 'zero' | 'in_stock' | 'no_reorder_level'
  scope?: 'active' | 'archived' | 'all'
  sort?: 'code' | 'name' | 'stock_asc' | 'stock_desc' | 'shortfall' | 'recent'
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
