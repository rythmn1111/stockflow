import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, YAxis } from 'recharts'
import {
  ArchiveIcon,
  ArrowDownUpIcon,
  MapPinIcon,
  PackageIcon,
  PencilIcon,
  ScaleIcon,
  TrashIcon,
  TruckIcon
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { DirectionIcon, ItemCode, ItemTypeBadge } from '@/components/stock-bits'
import { qk } from '@/lib/query-keys'
import { formatDate, formatDateTime, formatQty, formatRelative, formatWeight, MOVE_REASON_LABELS, pluralise } from '@/lib/format'
import { useAppMutation, useItemDetail } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

/**
 * Everything known about one item, gathered from what were five separate sheets: the
 * master row, its stock, its place in every bill of materials, its ledger history, and
 * which orders are holding it.
 */
export function ItemDetailSheet({
  itemId,
  onClose
}: {
  itemId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { data: detail, isLoading } = useItemDetail(itemId)
  const { openItemForm, openMoveForm } = useUiStore()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const archive = useAppMutation(
    ({ id, archived }: { id: string; archived: boolean }) => window.api.items.setArchived(id, archived),
    {
      invalidate: [qk.itemsRoot, qk.stats],
      successMessage: (_r, args) => (args.archived ? 'Item archived' : 'Item restored')
    }
  )

  const remove = useAppMutation((id: string) => window.api.items.remove(id), {
    invalidate: [qk.itemsRoot, qk.stats, qk.locationSummaries],
    successMessage: 'Item deleted',
    onSuccess: (result) => {
      if (result.ok) {
        setConfirmDelete(false)
        onClose()
      }
    }
  })

  const item = detail?.item

  return (
    <Sheet open={!!itemId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {isLoading || !detail || !item ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <ItemCode code={item.code} className="text-sm" />
                <ItemTypeBadge type={item.type} />
                {item.archivedAt && (
                  <Badge variant="muted" className="h-5 px-1.5 text-[10px]">
                    archived
                  </Badge>
                )}
              </div>
              <SheetTitle className="text-left text-lg">{item.name}</SheetTitle>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-6">
              {/* --- the numbers, and the arithmetic behind them --- */}
              <div className="rounded-lg border p-3">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[11px] text-muted-foreground">On hand</p>
                    <p className={cn('text-xl font-semibold tabular-nums', item.currentStock < 0 && 'text-destructive')}>
                      {formatQty(item.currentStock)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Committed</p>
                    <p className="text-xl font-semibold tabular-nums">{formatQty(item.committed)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Free</p>
                    <p className={cn('text-xl font-semibold tabular-nums', item.freeStock < 0 && 'text-destructive')}>
                      {formatQty(item.freeStock)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  {formatQty(item.openingStock)} opening + {formatQty(item.totalInward)} in −{' '}
                  {formatQty(item.totalOutward)} out = {formatQty(item.currentStock)} {item.unit}
                </p>
                {item.reorderLevel > 0 && (
                  <p
                    className={cn(
                      'mt-1 text-center text-[11px]',
                      item.belowReorder ? 'font-medium text-amber-600' : 'text-muted-foreground'
                    )}
                  >
                    {item.belowReorder ? 'Below' : 'Above'} the reorder level of {formatQty(item.reorderLevel, item.unit)}
                  </p>
                )}
              </div>

              {/* 30-day balance: the ledger made visible. */}
              {detail.balanceHistory.length > 0 && (
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={detail.balanceHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                      <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
                      <ChartTooltip
                        contentStyle={{
                          background: 'var(--popover)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 11
                        }}
                        labelFormatter={(label) => String(label)}
                      />
                      <Area
                        type="stepAfter"
                        dataKey="balance"
                        name="Balance"
                        stroke="var(--color-blue-500)"
                        fill="var(--color-blue-500)"
                        fillOpacity={0.15}
                        strokeWidth={1.5}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  <p className="text-center text-[10px] text-muted-foreground">Balance, last 30 days</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openMoveForm({ itemId: item.id, direction: 'in' })}>
                  <ArrowDownUpIcon className="size-3.5" />
                  Record movement
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openItemForm(item.id)}>
                  <PencilIcon className="size-3.5" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => archive.mutate({ id: item.id, archived: !item.archivedAt })}
                >
                  <ArchiveIcon className="size-3.5" />
                  {item.archivedAt ? 'Restore' : 'Archive'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon className="size-3.5" />
                  Delete
                </Button>
              </div>

              <Separator />

              {/* --- the fields, each with what it is for --- */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Unit" value={item.unit} />
                <Field
                  label="Location"
                  value={item.location}
                  icon={MapPinIcon}
                  hint={item.location ? undefined : 'Set one to group pick lists'}
                />
                <Field label="Supplier" value={detail.supplier?.name} icon={TruckIcon} />
                <Field
                  label="Supplier contact"
                  value={detail.supplier?.contact ?? detail.supplier?.phone}
                />
                <Field label="Net weight" value={formatWeight(item.netWeight)} icon={ScaleIcon} />
                <Field label="Gross weight" value={formatWeight(item.grossWeight)} />
                <Field
                  label="Per box"
                  value={item.quantityPacked != null ? formatQty(item.quantityPacked, item.unit) : null}
                  icon={PackageIcon}
                  hint={item.quantityPacked == null ? 'Set to get carton counts' : undefined}
                />
                <Field label="Box details" value={item.packingBoxDetails} />
                <Field label="Last movement" value={item.lastMovedAt ? formatRelative(item.lastMovedAt) : 'never'} />
                <Field label="Used in" value={item.usedInBomCount > 0 ? pluralise(item.usedInBomCount, 'product') : null} />
              </div>

              {item.notes && (
                <div className="rounded-md bg-muted/40 p-2.5 text-sm">
                  <p className="mb-1 text-[11px] text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap">{item.notes}</p>
                </div>
              )}

              <Tabs defaultValue="ledger">
                <TabsList className="w-full">
                  <TabsTrigger value="ledger" className="flex-1 text-xs">
                    Ledger ({detail.recentMoves.length})
                  </TabsTrigger>
                  <TabsTrigger value="bom" className="flex-1 text-xs">
                    Bill of materials
                  </TabsTrigger>
                  <TabsTrigger value="orders" className="flex-1 text-xs">
                    Committed ({detail.commitments.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="ledger" className="mt-3 space-y-1.5">
                  {detail.recentMoves.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nothing logged yet. Opening stock is {formatQty(item.openingStock, item.unit)}.
                    </p>
                  ) : (
                    detail.recentMoves.map((move) => (
                      <div
                        key={move.id}
                        className={cn(
                          'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                          move.voidedAt && 'opacity-50'
                        )}
                      >
                        <DirectionIcon direction={move.direction} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className={cn('font-medium tabular-nums', move.voidedAt && 'line-through')}>
                              {formatQty(move.qty, move.itemUnit)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {MOVE_REASON_LABELS[move.reason] ?? move.reason}
                            </span>
                            {move.orderNo && (
                              <Badge variant="muted" className="h-4 px-1 text-[10px]">
                                order {move.orderNo}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDate(move.movedAt)}
                            {move.referenceNo ? ` · ref ${move.referenceNo}` : ''}
                            {move.remarks ? ` · ${move.remarks}` : ''}
                          </p>
                          {move.voidedAt && (
                            <p className="text-[11px] text-destructive">Voided: {move.voidedReason}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="bom" className="mt-3 space-y-3">
                  {detail.componentsOf.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] text-muted-foreground">Built from</p>
                      <div className="space-y-1">
                        {detail.componentsOf.map((line) => (
                          <div key={line.id} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <ItemCode code={line.rmCode} />
                              <span className="truncate text-muted-foreground">{line.rmName}</span>
                            </span>
                            <span className="tabular-nums">
                              {formatQty(line.qtyPerUnit, line.rmUnit)}
                              {line.scrapPercent > 0 && (
                                <span className="ml-1 text-[11px] text-muted-foreground">+{line.scrapPercent}% scrap</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.usedIn.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] text-muted-foreground">Goes into</p>
                      <div className="space-y-1">
                        {detail.usedIn.map((line) => (
                          <div key={line.id} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <ItemCode code={line.fgCode} />
                              <span className="truncate text-muted-foreground">{line.fgName}</span>
                            </span>
                            <span className="tabular-nums">{formatQty(line.qtyPerUnit, line.rmUnit)} each</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.componentsOf.length === 0 && detail.usedIn.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Not on any bill of materials.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="orders" className="mt-3 space-y-1.5">
                  {detail.commitments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No open order is holding this item.
                    </p>
                  ) : (
                    detail.commitments.map((commitment) => (
                      <div key={commitment.orderId} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <div>
                          <p className="font-medium">Order {commitment.orderNo}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {commitment.dueDate ? `Due ${formatDate(commitment.dueDate)}` : 'No due date'}
                          </p>
                        </div>
                        <span className="tabular-nums">{formatQty(commitment.qty, item.unit)}</span>
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>

              <p className="text-center text-[10px] text-muted-foreground">
                Added {formatDateTime(item.createdAt)}
              </p>
            </div>

            <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {item.code}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cannot be undone. If the item has ledger history, bill-of-materials lines or orders, the
                    delete will be refused — archive it instead, which keeps the history intact.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(e) => {
                      e.preventDefault()
                      remove.mutate(item.id)
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  value,
  icon: Icon,
  hint
}: {
  label: string
  value: string | number | null | undefined
  icon?: typeof MapPinIcon
  hint?: string
}): React.JSX.Element {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value != null && value !== '' && value !== '—' ? (
        <p className="flex items-center gap-1 truncate">
          {Icon && <Icon className="size-3 shrink-0 text-muted-foreground" />}
          {value}
        </p>
      ) : (
        <p className="text-muted-foreground/50">{hint ?? '—'}</p>
      )}
    </div>
  )
}
