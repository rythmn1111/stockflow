import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BoxesIcon,
  ClipboardListIcon,
  PackageXIcon,
  ShoppingCartIcon,
  TrendingDownIcon,
  TruckIcon
} from 'lucide-react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { ItemCode } from '@/components/stock-bits'
import { useStats } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { formatQty, pluralise } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The screen the workbook had no room for. Its six sheets could each answer one
 * question; nothing put "what needs attention today" in one place.
 */
export function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useStats()
  const { setItemFilters } = useUiStore()

  if (isLoading || !stats) {
    return (
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const empty = stats.itemCount === 0

  if (empty) {
    return (
      <div className="p-5">
        <EmptyState
          icon={BoxesIcon}
          title="Nothing in the item master yet"
          description="Add your raw materials and finished goods, then build each finished good's bill of materials. Orders and stock planning follow from there."
          action={<Button onClick={() => useUiStore.getState().openItemForm()}>Add the first item</Button>}
        />
      </div>
    )
  }

  const tiles = [
    {
      label: 'Items',
      value: String(stats.itemCount),
      hint: stats.byType.map((t) => `${t.count} ${t.label.toLowerCase()}`).join(' · ') || 'none yet',
      icon: BoxesIcon,
      onClick: () => navigate('/items')
    },
    {
      label: 'Below reorder',
      value: String(stats.belowReorderCount),
      hint: stats.noReorderLevelCount > 0 ? `${stats.noReorderLevelCount} have no level set` : 'On free stock',
      icon: TrendingDownIcon,
      tone: stats.belowReorderCount > 0 ? ('warning' as const) : undefined,
      onClick: () => {
        setItemFilters({ stockFilter: 'below_reorder', sort: 'shortfall' })
        navigate('/items')
      }
    },
    {
      label: 'Open orders',
      value: String(stats.openOrderCount),
      hint:
        stats.ordersWithShortage > 0
          ? `${stats.ordersWithShortage} short of material`
          : 'All covered by stock',
      icon: ClipboardListIcon,
      tone: stats.ordersWithShortage > 0 ? ('warning' as const) : undefined,
      onClick: () => navigate('/orders')
    },
    {
      label: 'To buy',
      value: String(stats.totalShortageLines),
      hint: stats.totalShortageLines > 0 ? 'Shortage lines across plans' : 'Nothing outstanding',
      icon: ShoppingCartIcon,
      tone: stats.totalShortageLines > 0 ? ('destructive' as const) : undefined,
      onClick: () => navigate('/purchasing')
    }
  ]

  const chartData = stats.activityByDay.map((day) => ({
    ...day,
    label: day.date.slice(5).replace('-', '/')
  }))

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card
            key={tile.label}
            onClick={tile.onClick}
            className={cn(
              'cursor-pointer transition-colors hover:border-foreground/20',
              tile.tone === 'destructive' && 'border-destructive/30',
              tile.tone === 'warning' && 'border-amber-500/30'
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{tile.label}</p>
                  <p
                    className={cn(
                      'mt-1 text-2xl font-semibold tabular-nums',
                      tile.tone === 'destructive' && 'text-destructive',
                      tile.tone === 'warning' && 'text-amber-600'
                    )}
                  >
                    {tile.value}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{tile.hint}</p>
                </div>
                <tile.icon className="size-4 shrink-0 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Data-integrity warnings: quiet when there is nothing wrong. */}
      {(stats.negativeStockCount > 0 || stats.orphanItemCount > 0 || stats.itemsWithoutSupplier > 0) && (
        <div className="flex flex-wrap gap-2">
          {stats.negativeStockCount > 0 && (
            <button
              onClick={() => {
                setItemFilters({ stockFilter: 'negative', sort: 'stock_asc' })
                navigate('/items')
              }}
              className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <PackageXIcon className="size-3.5" />
              {pluralise(stats.negativeStockCount, 'item')} at negative stock
              <ArrowRightIcon className="size-3" />
            </button>
          )}
          {stats.itemsWithoutSupplier > 0 && (
            <button
              onClick={() => {
                setItemFilters({ noSupplier: true, stockFilter: 'all' })
                navigate('/items')
              }}
              className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20"
            >
              <TruckIcon className="size-3.5" />
              {pluralise(stats.itemsWithoutSupplier, 'item')} with no supplier — they cannot reach a purchase list
              <ArrowRightIcon className="size-3" />
            </button>
          )}
          {stats.orphanItemCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
              <AlertTriangleIcon className="size-3.5" />
              {pluralise(stats.orphanItemCount, 'item')} unused: no movements, no bill of materials, no orders
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="self-start lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Movements, last 14 days</CardTitle>
          </CardHeader>
          <CardContent className="h-56 pt-2">
            {stats.movesThisWeek === 0 && chartData.every((d) => d.inward === 0 && d.outward === 0) ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No stock movements logged yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" allowDecimals={false} />
                  <ChartTooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                  />
                  <Bar dataKey="inward" name="Inward" fill="var(--color-emerald-500)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outward" name="Outward" fill="var(--color-amber-500)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Reorder now</CardTitle>
            {stats.reorderList.length > 0 && (
              <CardAction>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => navigate('/purchasing')}>
                  Purchase list
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {stats.reorderList.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Everything is above its reorder level</p>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {stats.reorderList.map((row) => (
                  <div key={row.code} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <ItemCode code={row.code} />
                      <p className="truncate text-[11px] text-muted-foreground">{row.name}</p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <p className={cn('text-xs font-medium', row.freeStock <= 0 && 'text-destructive')}>
                        {formatQty(row.freeStock, row.unit)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">of {formatQty(row.reorderLevel)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {stats.topShortages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Biggest shortages across open plans</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => navigate('/purchasing')}>
                Group by supplier
                <ArrowRightIcon className="ml-1 size-3" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {stats.topShortages.map((row, i) => (
                <div key={`${row.code}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <ItemCode code={row.code} />
                    <span className="truncate text-muted-foreground">{row.name}</span>
                    <Badge variant="muted" className="h-4 shrink-0 px-1 text-[10px]">
                      order {row.orderNo}
                    </Badge>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-destructive">
                    short {formatQty(row.shortage, row.unit)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
