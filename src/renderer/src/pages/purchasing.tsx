import { CalendarClockIcon, DownloadIcon, PhoneIcon, ShoppingCartIcon, TruckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ItemCode } from '@/components/stock-bits'
import { usePurchasing } from '@/hooks/use-data'
import { formatDate, formatQty, pluralise } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The report the workbook could not produce at all.
 *
 * Its Material_Planning sheet held one order at a time, so it could tell you that order
 * 55 was short two of RM-03 — but never that orders 55, 56 and 58 all need the same part
 * from the same supplier. Grouping the shortages by vendor turns a pile of rows into a
 * short list of phone calls, and the supplier's lead time turns each one into a date.
 */
export function PurchasingPage(): React.JSX.Element {
  const { data: groups, isLoading } = usePurchasing()

  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    )
  }

  if (!groups?.length) {
    return (
      <div className="p-5">
        <EmptyState
          icon={ShoppingCartIcon}
          title="Nothing to buy"
          description="Every open order's material is covered by free stock. Shortages appear here as soon as a plan finds one."
        />
      </div>
    )
  }

  const totalLines = groups.reduce((sum, group) => sum + group.totalLines, 0)

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">
            {pluralise(totalLines, 'part')} to buy from {pluralise(groups.length, 'supplier')}
          </p>
          <p className="text-xs text-muted-foreground">
            Shortages across every open order&rsquo;s live plan, combined per part.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void window.api.purchasing.exportCsv()}>
          <DownloadIcon className="size-3.5" />
          Export purchase list
        </Button>
      </div>

      {groups.map((group) => (
        <Card key={group.supplierId ?? 'none'} className={cn(!group.supplierId && 'border-dashed')}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TruckIcon className="size-3.5 text-muted-foreground" />
                {group.supplierName}
                <Badge variant="muted" className="h-4 px-1 text-[10px]">
                  {group.totalLines}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {(group.supplierContact || group.supplierPhone) && (
                  <span className="inline-flex items-center gap-1">
                    <PhoneIcon className="size-3" />
                    {group.supplierContact ?? group.supplierPhone}
                  </span>
                )}
                {group.leadTimeDays != null && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClockIcon className="size-3" />
                    {pluralise(group.leadTimeDays, 'day')} lead time
                  </span>
                )}
              </div>
            </div>
            {!group.supplierId && (
              <p className="text-[11px] text-muted-foreground">
                No supplier is set on these items. Set one on the item so this becomes a callable list.
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Part</TableHead>
                  <TableHead className="w-28 text-right">Qty short</TableHead>
                  <TableHead className="w-28">Order by</TableHead>
                  <TableHead>Needed for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.lines.map((line) => {
                  const late = line.orderByDate != null && line.orderByDate < Date.now()
                  return (
                    <TableRow key={line.itemId}>
                      <TableCell>
                        <ItemCode code={line.code} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{line.name}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-destructive">
                        {formatQty(line.shortage, line.unit)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {line.orderByDate != null ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn(late ? 'font-medium text-destructive' : 'text-amber-600')}>
                                {formatDate(line.orderByDate)}
                                {late && ' — late'}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              Earliest order due date, minus this supplier&rsquo;s lead time.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {line.orders.map((order) => (
                            <Tooltip key={order.orderId}>
                              <TooltipTrigger asChild>
                                <Badge variant="muted" className="h-4 px-1 font-mono text-[10px]">
                                  {order.orderNo}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                Needs {formatQty(order.qty, line.unit)}
                                {order.dueDate ? ` · due ${formatDate(order.dueDate)}` : ''}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
