import { create } from 'zustand'
import type { ItemQuery, MoveQuery, OrderQuery } from '@shared/types'

interface UiState {
  paletteOpen: boolean
  itemFormOpen: boolean
  /** Set when editing; null when adding. */
  itemFormId: string | null
  itemFormDefaults: { code?: string; type?: 'RM' | 'FG' } | null
  moveFormOpen: boolean
  moveFormDefaults: { itemId?: string; direction?: 'in' | 'out'; orderId?: string } | null
  orderFormOpen: boolean
  orderFormId: string | null
  supplierFormOpen: boolean
  supplierFormId: string | null
  /** Item whose detail sheet is open, independent of the route. */
  openItemId: string | null
  searchFocusToken: number

  itemFilters: ItemQuery
  orderFilters: OrderQuery
  moveFilters: MoveQuery

  openPalette: () => void
  closePalette: () => void
  openItemForm: (id?: string | null, defaults?: { code?: string; type?: 'RM' | 'FG' }) => void
  closeItemForm: () => void
  openMoveForm: (defaults?: { itemId?: string; direction?: 'in' | 'out'; orderId?: string }) => void
  closeMoveForm: () => void
  openOrderForm: (id?: string | null) => void
  closeOrderForm: () => void
  openSupplierForm: (id?: string | null) => void
  closeSupplierForm: () => void
  setOpenItem: (id: string | null) => void
  focusSearch: () => void
  setItemFilters: (patch: Partial<ItemQuery>) => void
  resetItemFilters: () => void
  setOrderFilters: (patch: Partial<OrderQuery>) => void
  setMoveFilters: (patch: Partial<MoveQuery>) => void
}

const DEFAULT_ITEM_FILTERS: ItemQuery = { scope: 'active', type: 'all', sort: 'code', limit: 300 }
const DEFAULT_ORDER_FILTERS: OrderQuery = { sort: 'recent', limit: 200 }
const DEFAULT_MOVE_FILTERS: MoveQuery = { direction: 'all', limit: 200 }

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  itemFormOpen: false,
  itemFormId: null,
  itemFormDefaults: null,
  moveFormOpen: false,
  moveFormDefaults: null,
  orderFormOpen: false,
  orderFormId: null,
  supplierFormOpen: false,
  supplierFormId: null,
  openItemId: null,
  searchFocusToken: 0,

  itemFilters: DEFAULT_ITEM_FILTERS,
  orderFilters: DEFAULT_ORDER_FILTERS,
  moveFilters: DEFAULT_MOVE_FILTERS,

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openItemForm: (id, defaults) =>
    set({ itemFormOpen: true, itemFormId: id ?? null, itemFormDefaults: defaults ?? null, paletteOpen: false }),
  closeItemForm: () => set({ itemFormOpen: false, itemFormId: null, itemFormDefaults: null }),
  openMoveForm: (defaults) => set({ moveFormOpen: true, moveFormDefaults: defaults ?? null, paletteOpen: false }),
  closeMoveForm: () => set({ moveFormOpen: false, moveFormDefaults: null }),
  openOrderForm: (id) => set({ orderFormOpen: true, orderFormId: id ?? null, paletteOpen: false }),
  closeOrderForm: () => set({ orderFormOpen: false, orderFormId: null }),
  openSupplierForm: (id) => set({ supplierFormOpen: true, supplierFormId: id ?? null }),
  closeSupplierForm: () => set({ supplierFormOpen: false, supplierFormId: null }),
  setOpenItem: (openItemId) => set({ openItemId }),
  focusSearch: () => set((s) => ({ searchFocusToken: s.searchFocusToken + 1 })),
  setItemFilters: (patch) => set((s) => ({ itemFilters: { ...s.itemFilters, ...patch } })),
  resetItemFilters: () => set({ itemFilters: DEFAULT_ITEM_FILTERS }),
  setOrderFilters: (patch) => set((s) => ({ orderFilters: { ...s.orderFilters, ...patch } })),
  setMoveFilters: (patch) => set((s) => ({ moveFilters: { ...s.moveFilters, ...patch } }))
}))
