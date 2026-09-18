import type { ItemQuery, MoveQuery, OrderQuery } from '@shared/types'

/** Single source of truth for cache keys, so invalidation stays predictable. */
export const qk = {
  appInfo: ['app', 'info'] as const,
  settings: ['settings'] as const,
  suppliers: (search?: string) => ['suppliers', search ?? ''] as const,
  suppliersRoot: ['suppliers'] as const,
  items: (query: ItemQuery) => ['items', 'list', query] as const,
  itemsRoot: ['items'] as const,
  item: (id: string) => ['items', 'detail', id] as const,
  itemLocations: ['items', 'locations'] as const,
  itemUnits: ['items', 'units'] as const,
  stockAsOf: (at: number) => ['items', 'as-of', at] as const,
  bom: (fgItemId?: string) => ['bom', fgItemId ?? 'all'] as const,
  bomRoot: ['bom'] as const,
  explode: (fgItemId: string, qty: number) => ['bom', 'explode', fgItemId, qty] as const,
  orders: (query: OrderQuery) => ['orders', 'list', query] as const,
  ordersRoot: ['orders'] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  plan: (id: string) => ['plans', 'live', id] as const,
  planHistory: (id: string) => ['plans', 'history', id] as const,
  plansRoot: ['plans'] as const,
  packing: (id: string) => ['orders', 'packing', id] as const,
  weight: (id: string) => ['orders', 'weight', id] as const,
  pickList: (id: string) => ['orders', 'pick-list', id] as const,
  moves: (query: MoveQuery) => ['moves', 'list', query] as const,
  movesRoot: ['moves'] as const,
  purchasing: ['purchasing'] as const,
  locationSummaries: ['locations', 'summaries'] as const,
  stats: ['dashboard', 'stats'] as const,
  backups: ['backups'] as const
}

/**
 * Which query roots a change event invalidates. Stock is derived from the ledger and
 * commitments come from plans, so a movement or a plan touches far more of the screen
 * than it looks like it should — these lists are deliberately generous.
 */
export const INVALIDATION_MAP: Record<string, readonly (readonly string[])[]> = {
  items: [['items'], ['bom'], ['purchasing'], ['locations'], ['dashboard'], ['orders'], ['plans']],
  suppliers: [['suppliers'], ['items'], ['purchasing'], ['plans']],
  bom: [['bom'], ['orders'], ['plans'], ['dashboard']],
  orders: [['orders'], ['plans'], ['items'], ['purchasing'], ['dashboard']],
  moves: [['moves'], ['items'], ['orders'], ['plans'], ['purchasing'], ['locations'], ['dashboard']],
  plans: [['plans'], ['orders'], ['items'], ['purchasing'], ['dashboard']],
  settings: [['settings']],
  all: [['items'], ['suppliers'], ['bom'], ['orders'], ['moves'], ['plans'], ['purchasing'], ['locations'], ['dashboard'], ['settings']]
}
