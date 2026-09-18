import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  AppSettings,
  DashboardStats,
  ItemQuery,
  ItemWithStock,
  LocationSummary,
  MoveQuery,
  OrderQuery,
  OrderWithItem,
  PlanWithLines,
  PurchaseSuggestion,
  Supplier
} from '@shared/types'
import { INVALIDATION_MAP, qk } from '@/lib/query-keys'

const api = (): Window['api'] => window.api

/* --------------------------------- queries -------------------------------- */

export function useSettings(): UseQueryResult<AppSettings> {
  return useQuery({ queryKey: qk.settings, queryFn: () => api().settings.get(), staleTime: 30_000 })
}

export function useAppInfo() {
  return useQuery({ queryKey: qk.appInfo, queryFn: () => api().app.info(), staleTime: Infinity })
}

export function useStats(): UseQueryResult<DashboardStats> {
  return useQuery({ queryKey: qk.stats, queryFn: () => api().dashboard.stats(), staleTime: 10_000 })
}

export function useSuppliers(search?: string): UseQueryResult<Supplier[]> {
  return useQuery({ queryKey: qk.suppliers(search), queryFn: () => api().suppliers.list(search), staleTime: 30_000 })
}

export function useItems(query: ItemQuery): UseQueryResult<{ items: ItemWithStock[]; total: number }> {
  return useQuery({
    queryKey: qk.items(query),
    queryFn: () => api().items.list(query),
    // Keeps the table on screen while a filter change is in flight, so the layout
    // does not collapse to a spinner on every keystroke.
    placeholderData: (prev) => prev
  })
}

export function useItemDetail(id: string | null) {
  return useQuery({
    queryKey: qk.item(id ?? 'none'),
    queryFn: () => (id ? api().items.detail(id) : Promise.resolve(null)),
    enabled: !!id
  })
}

export function useItemLocations(): UseQueryResult<string[]> {
  return useQuery({ queryKey: qk.itemLocations, queryFn: () => api().items.locations(), staleTime: 60_000 })
}

export function useItemUnits(): UseQueryResult<string[]> {
  return useQuery({ queryKey: qk.itemUnits, queryFn: () => api().items.units(), staleTime: 60_000 })
}

export function useBom(fgItemId?: string) {
  return useQuery({ queryKey: qk.bom(fgItemId), queryFn: () => api().bom.list(fgItemId), staleTime: 30_000 })
}

export function useExplosion(fgItemId: string | null, qty: number) {
  return useQuery({
    queryKey: qk.explode(fgItemId ?? 'none', qty),
    queryFn: () => (fgItemId ? api().bom.explode(fgItemId, qty) : Promise.resolve({ lines: [], cycle: null })),
    enabled: !!fgItemId && qty > 0
  })
}

export function useOrders(query: OrderQuery): UseQueryResult<{ items: OrderWithItem[]; total: number }> {
  return useQuery({
    queryKey: qk.orders(query),
    queryFn: () => api().orders.list(query),
    placeholderData: (prev) => prev
  })
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: qk.order(id ?? 'none'),
    queryFn: () => (id ? api().orders.get(id) : Promise.resolve(null)),
    enabled: !!id
  })
}

export function usePlan(orderId: string | null): UseQueryResult<PlanWithLines | null> {
  return useQuery({
    queryKey: qk.plan(orderId ?? 'none'),
    queryFn: () => (orderId ? api().orders.plan_get(orderId) : Promise.resolve(null)),
    enabled: !!orderId
  })
}

export function usePlanHistory(orderId: string | null) {
  return useQuery({
    queryKey: qk.planHistory(orderId ?? 'none'),
    queryFn: () => (orderId ? api().orders.planHistory(orderId) : Promise.resolve([])),
    enabled: !!orderId
  })
}

export function usePacking(orderId: string | null) {
  return useQuery({
    queryKey: qk.packing(orderId ?? 'none'),
    queryFn: () => (orderId ? api().orders.packing(orderId) : Promise.resolve(null)),
    enabled: !!orderId
  })
}

export function useWeight(orderId: string | null) {
  return useQuery({
    queryKey: qk.weight(orderId ?? 'none'),
    queryFn: () => (orderId ? api().orders.weight(orderId) : Promise.resolve(null)),
    enabled: !!orderId
  })
}

export function usePickList(orderId: string | null) {
  return useQuery({
    queryKey: qk.pickList(orderId ?? 'none'),
    queryFn: () => (orderId ? api().orders.pickList(orderId) : Promise.resolve(null)),
    enabled: !!orderId
  })
}

export function useMoves(query: MoveQuery) {
  return useQuery({
    queryKey: qk.moves(query),
    queryFn: () => api().moves.list(query),
    placeholderData: (prev) => prev
  })
}

export function usePurchasing(): UseQueryResult<PurchaseSuggestion[]> {
  return useQuery({ queryKey: qk.purchasing, queryFn: () => api().purchasing.suggestions() })
}

export function useLocationSummaries(): UseQueryResult<LocationSummary[]> {
  return useQuery({ queryKey: qk.locationSummaries, queryFn: () => api().locations.summaries() })
}

export function useStockAsOf(at: number | null) {
  return useQuery({
    queryKey: qk.stockAsOf(at ?? 0),
    queryFn: () => (at ? api().items.stockAsOf(at) : Promise.resolve([])),
    enabled: !!at
  })
}

export function useBackups() {
  return useQuery({ queryKey: qk.backups, queryFn: () => api().backup.list() })
}

/* ------------------------------ live plumbing ----------------------------- */

/**
 * The main process is the source of truth. Stock is derived from the ledger and
 * commitments from plans, so one write ripples across most of the UI — these
 * subscriptions keep every screen honest without polling.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    return api().on.dataChanged(({ scope }) => {
      for (const key of INVALIDATION_MAP[scope] ?? INVALIDATION_MAP.all!) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    })
  }, [queryClient])
}

/* -------------------------------- mutations -------------------------------- */

/**
 * Shared mutation wrapper. Handlers in the main process return `{ ok, error }` rather
 * than throwing for expected refusals — "you cannot issue 20 when 10 is on the shelf"
 * is an answer, not a crash — so this surfaces both shapes the same way.
 */
export function useAppMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: {
    invalidate?: readonly (readonly unknown[])[]
    successMessage?: string | ((result: TResult, args: TArgs) => string | null)
    errorMessage?: string
    onSuccess?: (result: TResult, args: TArgs) => void
  } = {}
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => {
      const refused = result && typeof result === 'object' && 'ok' in result && (result as { ok: unknown }).ok === false
      if (refused) {
        const message = (result as { error?: string }).error
        toast.error(message ?? options.errorMessage ?? 'That could not be done')
        return
      }

      for (const key of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey: key })

      // A warning rides alongside a successful write, e.g. stock went negative.
      const warning = result && typeof result === 'object' && 'warning' in result
        ? (result as { warning?: string }).warning
        : undefined
      if (warning) toast.warning(warning)

      const message =
        typeof options.successMessage === 'function' ? options.successMessage(result, args) : options.successMessage
      if (message) toast.success(message)
      options.onSuccess?.(result, args)
    },
    onError: (error: Error) => {
      toast.error(options.errorMessage ?? 'Something went wrong', { description: error.message })
    }
  })
}
