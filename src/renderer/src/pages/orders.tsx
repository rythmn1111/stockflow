import { useState } from 'react'
import { ClipboardListIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { OrderStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ItemCode, OrderStatusBadge } from '@/components/stock-bits'
import { OrderDetailSheet } from '@/features/order-detail-sheet'
import { useOrders } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { formatDate, formatDue, formatQty, pluralise } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_GROUPS: { value: string; label: string; statuses?: OrderStatus[] }[] = [
  { value: 'open', label: 'Open', statuses: ['draft', 'planned', 'in_production'] },
  { value: 'all', label: 'All orders' },
  { value: 'draft', label: 'Draft', statuses: ['draft'] },
  { value: 'planned', label: 'Planned', statuses: ['planned'] },
  { value: 'in_production', label: 'In production', statuses: ['in_production'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] }
]

/**
 * The Order_Received sheet. The Status column that sat unused in the workbook is the
 * spine here: draft → planned → in production → completed, driven by planning and by
 * booking production rather than typed in by hand.
 */
export function OrdersPage(): React.JSX.Element {
  const { orderFilters, setOrderFilters, openOrderForm } = useUiStore()
  const [group, setGroup] = useState('open')
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)

  const statuses = STATUS_GROUPS.find((g) => g.value === group)?.statuses
  const { data, isLoading, isPlaceholderData } = useOrders({ ...orderFilters, statuses })

  const orders = data?.items ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={orderFilters.search ?? ''}
            onChange={(e) => setOrderFilters({ search: e.target.value })}
            placeholder="Search order no., customer, product…"
            className="h-8 pl-8"
          />
        </div>

        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_GROUPS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={orderFilters.sort ?? 'recent'} onValueChange={(value) => setOrderFilters({ sort: value as never })}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Sort: Newest</SelectItem>
            <SelectItem value="order_no">Sort: Order no.</SelectItem>
            <SelectItem value="due">Sort: Due soonest</SelectItem>
            <SelectItem value="shortage">Sort: Most short</SelectItem>
          </SelectContent>
        </Select>

        <Button size="sm" className="ml-auto h-8 gap-1.5" onClick={() => openOrderForm()}>
          <PlusIcon className="size-3.5" />
          New order
        </Button>
      </div>

      <div className="px-4 py-1.5 text-xs text-muted-foreground">{data ? pluralise(data.total, 'order') : '…'}</div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ClipboardListIcon}
            title={orderFilters.search ? 'No orders match' : group === 'open' ? 'No open orders' : 'No orders yet'}
            description="An order records what a customer asked for. Plan it to find out what material it needs."
            action={<Button onClick={() => openOrderForm()}>Create an order</Button>}
          />
        ) : (
          <Table className={cn(isPlaceholderData && 'opacity-60')}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Order</TableHead>
                <TableHead className="w-24">Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-32">Material</TableHead>
                <TableHead className="w-28">Progress</TableHead>
                <TableHead className="w-32">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const due = formatDue(order.dueDate)
                const open = order.status === 'draft' || order.status === 'planned' || order.status === 'in_production'
                return (
                  <TableRow key={order.id} className="cursor-pointer" onClick={() => setOpenOrderId(order.id)}>
                    <TableCell className="font-mono text-xs font-medium">{order.orderNo}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(order.orderDate)}</TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <ItemCode code={order.fgCode} />
                        <span className="truncate text-muted-foreground">{order.fgName}</span>
                      </div>
                      {order.customer && (
                        <p className="truncate text-[11px] text-muted-foreground">for {order.customer}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(order.qtyOrdered)}</TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {!order.latestPlanId ? (
                        <span className="text-muted-foreground">Not planned</span>
                      ) : order.shortageLines > 0 ? (
                        <span className="font-medium text-destructive">
                          {pluralise(order.shortageLines, 'line')} short
                        </span>
                      ) : (
                        <span className="text-emerald-500">Fully covered</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {order.producedQty > 0
                        ? `${formatQty(order.producedQty)} / ${formatQty(order.qtyOrdered)} built`
                        : order.issuedLines > 0
                          ? `${pluralise(order.issuedLines, 'part')} issued`
                          : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {order.dueDate ? (
                        <span
                          className={cn(
                            due.tone === 'overdue' && open && 'font-medium text-destructive',
                            due.tone === 'soon' && open && 'text-amber-600',
                            (due.tone === 'later' || !open) && 'text-muted-foreground'
                          )}
                        >
                          {open ? due.label : formatDate(order.dueDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <OrderDetailSheet orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
    </div>
  )
}
