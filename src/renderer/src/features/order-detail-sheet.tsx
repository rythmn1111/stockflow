import { useState } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FactoryIcon,
  HistoryIcon,
  MapPinIcon,
  PackageIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  ScaleIcon,
  TruckIcon
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BoxCount, ItemCode, OrderStatusBadge, ShortageCell } from '@/components/stock-bits'
import { qk } from '@/lib/query-keys'
import { formatDate, formatDateTime, formatQty, formatWeight, pluralise } from '@/lib/format'
import {
  useAppMutation,
  useOrder,
  usePacking,
  usePickList,
  usePlan,
  usePlanHistory,
  useWeight
} from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { OrderStatus } from '@shared/types'

/**
 * One order, everything about it.
 *
 * This replaces the workbook's `ProcessOrder` macro and the shared Material_Planning
 * sheet it wrote to. The plan lives with the order, so planning a second order no
 * longer destroys the first one's answer, and "issue all available" writes the ledger
 * entries that used to be typed in by hand.
 */
export function OrderDetailSheet({
  orderId,
  onClose
}: {
  orderId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { data: order, isLoading } = useOrder(orderId)
  const { data: plan } = usePlan(orderId)
  const { data: packing } = usePacking(orderId)
  const { data: weight } = useWeight(orderId)
  const { data: pickList } = usePickList(orderId)
  const { data: history } = usePlanHistory(orderId)
  const { openOrderForm } = useUiStore()

  const [selected, setSelected] = useState<string[]>([])
  const [produceQty, setProduceQty] = useState('')

  const invalidateAll = [
    qk.ordersRoot,
    qk.plansRoot,
    qk.itemsRoot,
    qk.movesRoot,
    qk.purchasing,
    qk.stats,
    qk.locationSummaries
  ]

  const runPlan = useAppMutation((id: string) => window.api.orders.plan(id), {
    invalidate: invalidateAll,
    successMessage: (result) => {
      if (!result.plan) return null
      const short = result.plan.lines.filter((l) => l.shortage > 0).length
      return short === 0
        ? `Planned — all ${pluralise(result.plan.lines.length, 'component')} covered by stock`
        : `Planned — ${pluralise(short, 'component')} short`
    }
  })

  const issue = useAppMutation(
    ({ id, only }: { id: string; only?: string[] }) => window.api.orders.issueMaterial(id, only),
    {
      invalidate: invalidateAll,
      successMessage: (result) =>
        result.issued.length
          ? `Issued ${pluralise(result.issued.length, 'component')}${result.short.length ? `, ${result.short.length} still short` : ''}`
          : null,
      errorMessage: 'Nothing could be issued',
      onSuccess: () => setSelected([])
    }
  )

  const book = useAppMutation(
    ({ id, qty }: { id: string; qty: number }) => window.api.orders.bookProduction(id, qty),
    {
      invalidate: invalidateAll,
      successMessage: 'Production booked',
      onSuccess: (result) => {
        if (result.ok) setProduceQty('')
      }
    }
  )

  const setStatus = useAppMutation(
    ({ id, status }: { id: string; status: OrderStatus }) => window.api.orders.setStatus(id, status),
    { invalidate: invalidateAll, successMessage: 'Status updated' }
  )

  if (!orderId) return <Sheet open={false} onOpenChange={() => undefined} />

  const lines = plan?.lines ?? []
  const shortLines = lines.filter((l) => l.shortage > 0)
  const issuable = lines.filter((l) => l.qtyRequired - l.alreadyIssued > 0)
  const remaining = order ? order.qtyOrdered - order.producedQty : 0

  return (
    <Sheet open={!!orderId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {isLoading || !order ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">Order {order.orderNo}</span>
                <OrderStatusBadge status={order.status} />
              </div>
              <SheetTitle className="text-left text-lg">
                <ItemCode code={order.fgCode} className="text-base" />
                <span className="ml-2 font-normal text-muted-foreground">{order.fgName}</span>
              </SheetTitle>
              <p className="text-sm text-muted-foreground">
                {formatQty(order.qtyOrdered, order.fgUnit)}
                {order.customer ? ` · for ${order.customer}` : ''}
                {' · ordered '}
                {formatDate(order.orderDate)}
                {order.dueDate ? ` · due ${formatDate(order.dueDate)}` : ''}
              </p>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {/* --- actions --- */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={runPlan.isPending || order.status === 'cancelled'}
                  onClick={() => runPlan.mutate(order.id)}
                >
                  <RefreshCwIcon className={cn('size-3.5', runPlan.isPending && 'animate-spin')} />
                  {plan ? 'Re-plan' : 'Plan material'}
                </Button>

                {!!issuable.length && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={issue.isPending}
                    onClick={() => issue.mutate({ id: order.id, only: selected.length ? selected : undefined })}
                  >
                    <PlayIcon className="size-3.5" />
                    {selected.length ? `Issue ${pluralise(selected.length, 'line')}` : 'Issue all available'}
                  </Button>
                )}

                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => openOrderForm(order.id)}>
                  <PencilIcon className="size-3.5" />
                  Edit
                </Button>

                <Select value={order.status} onValueChange={(value) => setStatus.mutate({ id: order.id, status: value as OrderStatus })}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in_production">In production</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* --- packing and weight, from the item's own fields --- */}
              {(packing || weight) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {packing && (
                    <div className="rounded-lg border p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <PackageIcon className="size-3.5" />
                        Ships as
                      </p>
                      <BoxCount
                        fullBoxes={packing.finished.fullBoxes}
                        loose={packing.finished.loose}
                        totalBoxes={packing.finished.totalBoxes}
                        unit={packing.finished.unit}
                      />
                      {packing.finished.boxDetails && (
                        <p className="mt-1 text-[11px] text-muted-foreground">{packing.finished.boxDetails}</p>
                      )}
                      {packing.gaps.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="mt-1.5 cursor-help text-[11px] text-amber-600">
                              {pluralise(packing.gaps.length, 'field')} missing
                            </p>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <ul className="space-y-0.5 text-xs">
                              {packing.gaps.map((gap) => (
                                <li key={gap}>· {gap}</li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}

                  {weight && (
                    <div className="rounded-lg border p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ScaleIcon className="size-3.5" />
                        Weight
                      </p>
                      <div className="space-y-0.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Finished, gross</span>
                          <span className="tabular-nums">{formatWeight(weight.finishedGross)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Material to issue</span>
                          <span className="tabular-nums">{formatWeight(weight.materialNet)}</span>
                        </div>
                      </div>
                      {weight.missingWeightCodes.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          Partial — no weight on {weight.missingWeightCodes.slice(0, 3).join(', ')}
                          {weight.missingWeightCodes.length > 3 ? ` +${weight.missingWeightCodes.length - 3}` : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* --- booking production --- */}
              {order.status !== 'cancelled' && remaining > 0 && order.issuedLines > 0 && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/40 p-3">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <FactoryIcon className="size-3.5" />
                      Book finished units into stock
                    </Label>
                    <Input
                      className="h-8 w-28"
                      value={produceQty}
                      onChange={(e) => setProduceQty(e.target.value)}
                      placeholder={String(remaining)}
                      inputMode="decimal"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={book.isPending}
                    onClick={() => book.mutate({ id: order.id, qty: Number(produceQty) || remaining })}
                  >
                    Book {formatQty(Number(produceQty) || remaining, order.fgUnit)}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    {formatQty(order.producedQty)} of {formatQty(order.qtyOrdered)} built · {formatQty(remaining)} left
                  </p>
                </div>
              )}

              {order.status === 'completed' && (
                <p className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600">
                  <CheckCircle2Icon className="size-4" />
                  All {formatQty(order.qtyOrdered, order.fgUnit)} built and booked into stock.
                </p>
              )}

              <Separator />

              {!plan ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    This order has not been planned yet. Planning explodes {order.fgCode}&rsquo;s bill of materials by{' '}
                    {formatQty(order.qtyOrdered)} and works out what has to be bought.
                  </p>
                  <Button className="mt-3 gap-1.5" size="sm" onClick={() => runPlan.mutate(order.id)}>
                    <RefreshCwIcon className="size-3.5" />
                    Plan material
                  </Button>
                </div>
              ) : (
                <Tabs defaultValue="plan">
                  <TabsList className="w-full">
                    <TabsTrigger value="plan" className="flex-1 text-xs">
                      Plan ({lines.length})
                    </TabsTrigger>
                    <TabsTrigger value="pick" className="flex-1 text-xs">
                      Pick list
                    </TabsTrigger>
                    <TabsTrigger value="history" className="flex-1 text-xs">
                      History ({history?.length ?? 0})
                    </TabsTrigger>
                  </TabsList>

                  {/* ---------------------- the plan ---------------------- */}
                  <TabsContent value="plan" className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Planned {formatDateTime(plan.createdAt)}
                        {shortLines.length > 0 && (
                          <span className="ml-2 text-destructive">
                            · {pluralise(shortLines.length, 'line')} short
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-xs"
                        onClick={() => void window.api.orders.exportPlanCsv(order.id)}
                      >
                        <DownloadIcon className="size-3" />
                        Export
                      </Button>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            <Checkbox
                              checked={selected.length > 0 && selected.length === issuable.length}
                              onCheckedChange={(checked) =>
                                setSelected(checked ? issuable.map((l) => l.rmItemId) : [])
                              }
                              aria-label="Select all issuable lines"
                            />
                          </TableHead>
                          <TableHead className="w-24">Code</TableHead>
                          <TableHead>Component</TableHead>
                          <TableHead className="w-24 text-right">Required</TableHead>
                          <TableHead className="w-20 text-right">Issued</TableHead>
                          <TableHead className="w-24 text-right">Available</TableHead>
                          <TableHead className="w-24 text-right">Short</TableHead>
                          <TableHead className="w-28">Supplier</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((line) => {
                          const outstanding = line.qtyRequired - line.alreadyIssued
                          const done = outstanding <= 0
                          return (
                            <TableRow key={line.id} className={cn(done && 'opacity-50')}>
                              <TableCell>
                                {!done && (
                                  <Checkbox
                                    checked={selected.includes(line.rmItemId)}
                                    onCheckedChange={(checked) =>
                                      setSelected((prev) =>
                                        checked ? [...prev, line.rmItemId] : prev.filter((id) => id !== line.rmItemId)
                                      )
                                    }
                                    aria-label={`Select ${line.rmCode}`}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                <span className="flex items-center gap-1.5">
                                  <span style={{ paddingLeft: `${(line.depth - 1) * 8}px` }}>
                                    <ItemCode code={line.rmCode} />
                                  </span>
                                  {line.depth > 1 && (
                                    <Badge variant="muted" className="h-3.5 px-1 text-[9px]">
                                      L{line.depth}
                                    </Badge>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-40 truncate">{line.rmName}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatQty(line.qtyRequired, line.rmUnit)}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                                {line.alreadyIssued > 0 ? formatQty(line.alreadyIssued) : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className={cn(
                                        'tabular-nums',
                                        line.currentFreeStock !== line.stockAvailable && 'underline decoration-dotted'
                                      )}
                                    >
                                      {formatQty(line.stockAvailable)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    Free stock when the plan ran. Now: {formatQty(line.currentFreeStock, line.rmUnit)}.
                                    {line.currentFreeStock !== line.stockAvailable &&
                                      ' Re-plan to work from the current figure.'}
                                  </TooltipContent>
                                </Tooltip>
                              </TableCell>
                              <TableCell className="text-right">
                                <ShortageCell shortage={line.shortage} unit={line.rmUnit} />
                              </TableCell>
                              <TableCell className="max-w-28 truncate text-xs text-muted-foreground">
                                {line.supplierName ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1">
                                        <TruckIcon className="size-3" />
                                        {line.supplierName}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                      {line.supplierContact ?? line.supplierPhone ?? 'No contact recorded'}
                                      {line.supplierLeadTimeDays != null && ` · ${line.supplierLeadTimeDays} day lead time`}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>

                    {shortLines.length > 0 && (
                      <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {pluralise(shortLines.length, 'component')} cannot be covered by free stock. The Purchasing
                          page groups this with every other order&rsquo;s shortages by supplier.
                        </span>
                      </p>
                    )}
                  </TabsContent>

                  {/* -------------------- the pick list -------------------- */}
                  <TabsContent value="pick" className="mt-3 space-y-3">
                    {!pickList || pickList.totalLines === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nothing left to pick — every component has been issued.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {pluralise(pickList.totalLines, 'line')} across {pluralise(pickList.stops.length, 'location')}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 text-xs"
                            onClick={() => void window.api.orders.exportPickListCsv(order.id)}
                          >
                            <DownloadIcon className="size-3" />
                            Print list
                          </Button>
                        </div>

                        {pickList.stops.map((stop) => (
                          <div key={stop.location} className="rounded-lg border">
                            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-sm font-medium">
                              <MapPinIcon className="size-3.5 text-muted-foreground" />
                              {stop.location}
                              <Badge variant="muted" className="h-4 px-1 text-[10px]">
                                {stop.lineCount}
                              </Badge>
                            </div>
                            <div className="divide-y">
                              {stop.lines.map((line) => (
                                <div key={line.itemId} className="flex items-center justify-between px-3 py-1.5 text-sm">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ItemCode code={line.code} />
                                    <span className="truncate text-muted-foreground">{line.name}</span>
                                  </span>
                                  <span className="shrink-0 text-right">
                                    <span className="font-medium tabular-nums">{formatQty(line.qtyToPick, line.unit)}</span>
                                    {line.shortfall > 0 && (
                                      <span className="ml-2 text-xs text-destructive">
                                        only {formatQty(line.onHand)} on shelf
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        {pickList.unlocated.length > 0 && (
                          <div className="rounded-lg border border-dashed">
                            <div className="border-b bg-muted/40 px-3 py-1.5 text-sm font-medium text-muted-foreground">
                              No location set
                            </div>
                            <div className="divide-y">
                              {pickList.unlocated.map((line) => (
                                <div key={line.itemId} className="flex items-center justify-between px-3 py-1.5 text-sm">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ItemCode code={line.code} />
                                    <span className="truncate text-muted-foreground">{line.name}</span>
                                  </span>
                                  <span className="shrink-0 font-medium tabular-nums">
                                    {formatQty(line.qtyToPick, line.unit)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
                              Give these a Location and they will join a stop above.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </TabsContent>

                  {/* ---------------------- plan history ---------------------- */}
                  <TabsContent value="history" className="mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Every plan ever run for this order. The workbook overwrote one shared sheet, so only the most
                      recent run survived.
                    </p>
                    {(history ?? []).map((entry, index) => (
                      <div
                        key={entry.id}
                        className={cn(
                          'flex items-center justify-between rounded-md border px-3 py-2 text-sm',
                          entry.supersededAt && 'opacity-60'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <HistoryIcon className="size-3.5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">
                              {formatDateTime(entry.createdAt)}
                              {index === 0 && !entry.supersededAt && (
                                <Badge variant="success" className="ml-2 h-4 px-1 text-[10px]">
                                  live
                                </Badge>
                              )}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {pluralise(entry.lineCount, 'component')}
                              {entry.totalShortage > 0 ? ` · ${formatQty(entry.totalShortage)} short in total` : ' · fully covered'}
                            </p>
                          </div>
                        </div>
                        {entry.supersededAt && (
                          <span className="text-[11px] text-muted-foreground">
                            superseded {formatDate(entry.supersededAt)}
                          </span>
                        )}
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              )}

              {order.notes && (
                <div className="rounded-md bg-muted/40 p-2.5 text-sm">
                  <p className="mb-1 text-[11px] text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{order.notes}</p>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
