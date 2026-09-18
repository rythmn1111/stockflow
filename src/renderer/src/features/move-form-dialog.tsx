import { useEffect, useMemo, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { MoveReason } from '@shared/types'
import type { MoveInput } from '@shared/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import { qk } from '@/lib/query-keys'
import { formatQty, MOVE_REASON_LABELS, toDateInput, fromDateInput } from '@/lib/format'
import { useAppMutation, useItems, useOrders, useSettings } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

/** Reasons that make sense per direction, so the list is never misleading. */
const INWARD_REASONS: MoveReason[] = ['purchase', 'production', 'return', 'adjustment', 'other']
const OUTWARD_REASONS: MoveReason[] = ['issue', 'sale', 'return', 'adjustment', 'other']

/**
 * The Material_Log sheet as a form.
 *
 * The workbook accepted whatever was typed: an item code that matched nothing, a
 * negative quantity, INWARD spelt three ways. Here the item is chosen from the master,
 * the direction is a toggle, and the resulting balance is shown before saving — so the
 * consequence of the entry is visible while there is still time to change it.
 */
export function MoveFormDialog(): React.JSX.Element {
  const { moveFormOpen, moveFormDefaults, closeMoveForm } = useUiStore()
  const { data: settings } = useSettings()
  const { data: itemsResult } = useItems({ scope: 'active', sort: 'code', limit: 2000 })
  const { data: ordersResult } = useOrders({ statuses: ['draft', 'planned', 'in_production'], limit: 200 })

  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<MoveReason>('purchase')
  const [movedAt, setMovedAt] = useState(toDateInput(Date.now()))
  const [referenceNo, setReferenceNo] = useState('')
  const [orderId, setOrderId] = useState('')
  const [remarks, setRemarks] = useState('')

  useEffect(() => {
    if (!moveFormOpen) return
    const nextDirection = moveFormDefaults?.direction ?? 'in'
    setDirection(nextDirection)
    setItemId(moveFormDefaults?.itemId ?? '')
    setOrderId(moveFormDefaults?.orderId ?? '')
    setReason(nextDirection === 'in' ? 'purchase' : 'issue')
    setQty('')
    setReferenceNo('')
    setRemarks('')
    setMovedAt(toDateInput(Date.now()))
  }, [moveFormOpen, moveFormDefaults])

  const items = itemsResult?.items ?? []
  const item = items.find((i) => i.id === itemId)
  const quantity = Number(qty.replace(/,/g, ''))
  const validQty = Number.isFinite(quantity) && quantity > 0

  // The whole point of showing this: what the shelf reads after saving.
  const resulting = useMemo(() => {
    if (!item || !validQty) return null
    return direction === 'in' ? item.currentStock + quantity : item.currentStock - quantity
  }, [item, validQty, direction, quantity])

  const wouldGoNegative = resulting != null && resulting < 0
  const blocked = wouldGoNegative && (settings?.blockNegativeStock ?? true)

  const reasons = direction === 'in' ? INWARD_REASONS : OUTWARD_REASONS
  useEffect(() => {
    // Switching direction can leave a reason that no longer applies.
    if (!reasons.includes(reason)) setReason(reasons[0]!)
  }, [direction, reason, reasons])

  const create = useAppMutation((input: MoveInput) => window.api.moves.create(input), {
    invalidate: [qk.movesRoot, qk.itemsRoot, qk.stats, qk.ordersRoot, qk.plansRoot, qk.purchasing, qk.locationSummaries],
    successMessage: (result) =>
      result.move ? `${result.move.itemCode}: ${direction === 'in' ? 'received' : 'issued'} ${formatQty(result.move.qty, result.move.itemUnit)}` : null,
    onSuccess: (result) => {
      if (result.ok) closeMoveForm()
    }
  })

  const submit = (): void => {
    if (!itemId || !validQty || blocked) return
    create.mutate({
      itemId,
      direction,
      qty: quantity,
      reason,
      movedAt: fromDateInput(movedAt) ?? Date.now(),
      referenceNo: referenceNo.trim() || null,
      orderId: orderId || null,
      remarks: remarks.trim() || null
    })
  }

  return (
    <Dialog open={moveFormOpen} onOpenChange={(open) => !open && closeMoveForm()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record stock movement</DialogTitle>
          <DialogDescription>One entry in the material log. Entries are never edited — only voided.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ToggleGroup
            type="single"
            value={direction}
            onValueChange={(value) => value && setDirection(value as 'in' | 'out')}
            className="grid grid-cols-2"
          >
            <ToggleGroupItem value="in" className="gap-1.5">
              <ArrowDownIcon className="size-3.5" />
              Inward
            </ToggleGroupItem>
            <ToggleGroupItem value="out" className="gap-1.5">
              <ArrowUpIcon className="size-3.5" />
              Outward
            </ToggleGroupItem>
          </ToggleGroup>

          <div className="space-y-1.5">
            <Label>Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an item from the master" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {items.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="font-mono text-xs">{option.code}</span>
                    <span className="ml-2 text-muted-foreground">{option.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qty">Quantity{item ? ` (${item.unit})` : ''}</Label>
              <Input
                id="qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                aria-invalid={blocked}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={movedAt} onChange={(e) => setMovedAt(e.target.value)} />
            </div>
          </div>

          {item && (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                blocked ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">On hand now</span>
                <span className="tabular-nums">{formatQty(item.currentStock, item.unit)}</span>
              </div>
              {resulting != null && (
                <div className="mt-1 flex items-center justify-between font-medium">
                  <span>After this entry</span>
                  <span className={cn('tabular-nums', resulting < 0 && 'text-destructive')}>
                    {formatQty(resulting, item.unit)}
                  </span>
                </div>
              )}
              {blocked && (
                <p className="mt-1.5 text-xs text-destructive">
                  This would leave negative stock. Log the receipt first, or allow negative stock in Settings.
                </p>
              )}
              {wouldGoNegative && !blocked && (
                <p className="mt-1.5 text-xs text-amber-600">
                  This leaves negative stock, which usually means a receipt was never logged.
                </p>
              )}
              {item.committed > 0 && direction === 'out' && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {formatQty(item.committed, item.unit)} of this is promised to open orders.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(value) => setReason(value as MoveReason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((option) => (
                    <SelectItem key={option} value={option}>
                      {MOVE_REASON_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref">Reference no.</Label>
              <Input
                id="ref"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="Invoice, challan…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-2">
              Against order
              <Badge variant="muted" className="h-4 px-1 text-[10px]">optional</Badge>
            </Label>
            <Select value={orderId || 'none'} onValueChange={(value) => setOrderId(value === 'none' ? '' : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Not linked to an order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked to an order</SelectItem>
                {(ordersResult?.items ?? []).map((order) => (
                  <SelectItem key={order.id} value={order.id}>
                    {order.orderNo} — {order.fgCode} × {formatQty(order.qtyOrdered)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Linking an issue to its order keeps that order&rsquo;s plan honest about what is left to pick.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeMoveForm} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!itemId || !validQty || blocked || create.isPending}>
            Save entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
