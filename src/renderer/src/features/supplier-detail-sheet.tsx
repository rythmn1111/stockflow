import {
  AlertTriangleIcon,
  CalendarClockIcon,
  DownloadIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  TruckIcon
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ItemCode, ItemTypeBadge, PreferredBadge } from '@/components/stock-bits'
import { formatDate, formatQty, pluralise } from '@/lib/format'
import { useSupplierDetail } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

/**
 * The supplier card.
 *
 * The workbook repeated a supplier's name on every item row, so answering "which parts
 * does this supplier give us?" meant reading the whole sheet by eye — and "what are
 * they currently holding up?" could not be answered at all, because planning only ever
 * held one order.
 */
export function SupplierDetailSheet({
  supplierId,
  onClose
}: {
  supplierId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { data: detail, isLoading } = useSupplierDetail(supplierId)
  const { openSupplierForm, setOpenItem } = useUiStore()

  return (
    <Sheet open={!!supplierId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {isLoading || !detail ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-20" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <TruckIcon className="size-4 text-muted-foreground" />
                <SheetTitle className="text-left text-lg">{detail.supplier.name}</SheetTitle>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {detail.supplier.contact && <span>{detail.supplier.contact}</span>}
                {detail.supplier.phone && (
                  <span className="inline-flex items-center gap-1">
                    <PhoneIcon className="size-3" />
                    {detail.supplier.phone}
                  </span>
                )}
                {detail.supplier.email && (
                  <span className="inline-flex items-center gap-1">
                    <MailIcon className="size-3" />
                    {detail.supplier.email}
                  </span>
                )}
                {detail.supplier.leadTimeDays != null && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClockIcon className="size-3" />
                    {pluralise(detail.supplier.leadTimeDays, 'day')} lead time
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {/* --- the three numbers that matter about a supplier --- */}
              <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-center">
                <div>
                  <p className="text-[11px] text-muted-foreground">Parts they sell</p>
                  <p className="text-xl font-semibold tabular-nums">{detail.parts.length}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Preferred source for</p>
                  <p className="text-xl font-semibold tabular-nums">{detail.preferredCount}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Outstanding lines</p>
                  <p
                    className={cn(
                      'text-xl font-semibold tabular-nums',
                      detail.outstanding.length > 0 && 'text-destructive'
                    )}
                  >
                    {detail.outstanding.length}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openSupplierForm(detail.supplier.id)}>
                  <PencilIcon className="size-3.5" />
                  Edit supplier
                </Button>
                {detail.parts.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => void window.api.suppliers.exportPartsCsv(detail.supplier.id)}
                  >
                    <DownloadIcon className="size-3.5" />
                    Export parts list
                  </Button>
                )}
              </div>

              {detail.supplier.address && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPinIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span className="whitespace-pre-wrap">{detail.supplier.address}</span>
                </p>
              )}

              <Separator />

              <Tabs defaultValue="parts">
                <TabsList className="w-full">
                  <TabsTrigger value="parts" className="flex-1 text-xs">
                    Parts ({detail.parts.length})
                  </TabsTrigger>
                  <TabsTrigger value="outstanding" className="flex-1 text-xs">
                    To order ({detail.outstanding.length})
                  </TabsTrigger>
                  <TabsTrigger value="receipts" className="flex-1 text-xs">
                    Receipts ({detail.recentReceipts.length})
                  </TabsTrigger>
                </TabsList>

                {/* --------------------- what they sell us --------------------- */}
                <TabsContent value="parts" className="mt-3">
                  {detail.parts.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No parts are linked to this supplier yet. Add them from an item&rsquo;s Suppliers section.
                    </p>
                  ) : (
                    <>
                      {detail.belowReorderCount > 0 && (
                        <p className="mb-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-600">
                          <AlertTriangleIcon className="size-3.5" />
                          {pluralise(detail.belowReorderCount, 'part')} from this supplier{' '}
                          {detail.belowReorderCount === 1 ? 'is' : 'are'} at or below its reorder level
                        </p>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Code</TableHead>
                            <TableHead>Part</TableHead>
                            <TableHead className="w-12">Type</TableHead>
                            <TableHead className="w-24">Their SKU</TableHead>
                            <TableHead className="w-20 text-right">Price</TableHead>
                            <TableHead className="w-24 text-right">Free stock</TableHead>
                            <TableHead className="w-20">Source</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.parts.map((part) => (
                            <TableRow
                              key={part.id}
                              className="cursor-pointer"
                              onClick={() => {
                                setOpenItem(part.itemId)
                                onClose()
                              }}
                            >
                              <TableCell>
                                <ItemCode code={part.code} />
                              </TableCell>
                              <TableCell className="max-w-40 truncate">
                                {part.name}
                                {(part.location || part.rack) && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {[part.location, part.rack].filter(Boolean).join(' / ')}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                <ItemTypeBadge type={part.type} />
                              </TableCell>
                              <TableCell className="truncate font-mono text-[11px] text-muted-foreground">
                                {part.supplierSku ?? '—'}
                              </TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {part.unitPrice != null ? part.unitPrice.toLocaleString() : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                <span
                                  className={cn(
                                    'tabular-nums',
                                    part.belowReorder && 'font-medium text-amber-600',
                                    part.freeStock < 0 && 'font-medium text-destructive'
                                  )}
                                >
                                  {formatQty(part.freeStock, part.unit)}
                                </span>
                              </TableCell>
                              <TableCell>
                                {part.isPreferredSource ? (
                                  <PreferredBadge />
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-[11px] text-muted-foreground">alternative</span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-64 text-xs">
                                      Another supplier is the preferred source for this part, so its shortages are
                                      grouped under them.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </TabsContent>

                {/* ------------------ what to actually order ------------------ */}
                <TabsContent value="outstanding" className="mt-3">
                  {detail.outstanding.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nothing outstanding — every part this supplier is the preferred source for is covered by stock.
                    </p>
                  ) : (
                    <>
                      {detail.outstandingValue != null && (
                        <p className="mb-2 text-xs text-muted-foreground">
                          Roughly <span className="font-medium text-foreground">{detail.outstandingValue.toLocaleString()}</span>{' '}
                          at the prices recorded here.
                        </p>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-24">Code</TableHead>
                            <TableHead>Part</TableHead>
                            <TableHead className="w-24 text-right">Qty short</TableHead>
                            <TableHead className="w-28">Order by</TableHead>
                            <TableHead>For orders</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detail.outstanding.map((line) => {
                            const late = line.orderByDate != null && line.orderByDate < Date.now()
                            return (
                              <TableRow key={line.itemId}>
                                <TableCell>
                                  <ItemCode code={line.code} />
                                </TableCell>
                                <TableCell className="max-w-40 truncate">{line.name}</TableCell>
                                <TableCell className="text-right font-medium tabular-nums text-destructive">
                                  {formatQty(line.shortage, line.unit)}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {line.orderByDate != null ? (
                                    <span className={cn(late ? 'font-medium text-destructive' : 'text-amber-600')}>
                                      {formatDate(line.orderByDate)}
                                      {late && ' — late'}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground/50">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {line.orderNos.map((no) => (
                                      <Badge key={no} variant="muted" className="h-4 px-1 font-mono text-[10px]">
                                        {no}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </TabsContent>

                {/* ----------------------- what arrived ----------------------- */}
                <TabsContent value="receipts" className="mt-3 space-y-1.5">
                  {detail.recentReceipts.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No purchase receipts logged for this supplier&rsquo;s parts yet.
                    </p>
                  ) : (
                    detail.recentReceipts.map((receipt) => (
                      <div
                        key={receipt.id}
                        className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="flex items-center gap-2">
                            <ItemCode code={receipt.code} />
                            <span className="truncate text-muted-foreground">{receipt.name}</span>
                          </span>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDate(receipt.movedAt)}
                            {receipt.referenceNo ? ` · ref ${receipt.referenceNo}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium tabular-nums text-emerald-500">
                          +{formatQty(receipt.qty, receipt.unit)}
                        </span>
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>

              {detail.supplier.notes && (
                <div className="rounded-md bg-muted/40 p-2.5 text-sm">
                  <p className="mb-1 text-[11px] text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{detail.supplier.notes}</p>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
