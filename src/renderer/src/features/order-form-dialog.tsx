import { useEffect, useState } from 'react'
import { AlertTriangleIcon, PackageIcon } from 'lucide-react'
import type { OrderStatus } from '@shared/types'
import type { OrderInput } from '@shared/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { qk } from '@/lib/query-keys'
import { formatQty, toDateInput, fromDateInput } from '@/lib/format'
import { useAppMutation, useExplosion, useItems, useOrder } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'

/**
 * The Order_Received sheet as a form, with two things the sheet could not do: the date
 * is a real date (the source workbook had an order typed as 2026 instead of 2025, which
 * a text column happily accepted), and the bill of materials is previewed live so a
 * finished good with no components is obvious before the order is saved.
 */
export function OrderFormDialog(): React.JSX.Element {
  const { orderFormOpen, orderFormId, closeOrderForm } = useUiStore()
  const { data: existing } = useOrder(orderFormOpen ? orderFormId : null)
  const { data: itemsResult } = useItems({ scope: 'active', type: 'FG', sort: 'code', limit: 1000 })

  const [orderNo, setOrderNo] = useState('')
  const [orderDate, setOrderDate] = useState(toDateInput(Date.now()))
  const [fgItemId, setFgItemId] = useState('')
  const [qtyOrdered, setQtyOrdered] = useState('')
  const [customer, setCustomer] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [status, setStatus] = useState<OrderStatus>('draft')
  const [notes, setNotes] = useState('')

  const editing = !!orderFormId

  useEffect(() => {
    if (!orderFormOpen) return
    if (editing && existing) {
      setOrderNo(existing.orderNo)
      setOrderDate(toDateInput(existing.orderDate))
      setFgItemId(existing.fgItemId)
      setQtyOrdered(String(existing.qtyOrdered))
      setCustomer(existing.customer ?? '')
      setDueDate(toDateInput(existing.dueDate))
      setStatus(existing.status)
      setNotes(existing.notes ?? '')
    } else if (!editing) {
      setOrderNo('')
      setOrderDate(toDateInput(Date.now()))
      setFgItemId('')
      setQtyOrdered('')
      setCustomer('')
      setDueDate('')
      setStatus('draft')
      setNotes('')
    }
  }, [orderFormOpen, editing, existing])

  const quantity = Number(qtyOrdered.replace(/,/g, ''))
  const validQty = Number.isFinite(quantity) && quantity > 0
  const fgItems = itemsResult?.items ?? []
  const fg = fgItems.find((i) => i.id === fgItemId)

  // Previewing the explosion here turns "no bill of materials" into something the user
  // sees while creating the order, rather than an error when they later try to plan it.
  const { data: explosion } = useExplosion(orderFormOpen ? fgItemId || null : null, validQty ? quantity : 0)

  const payload = (): OrderInput => ({
    orderNo: orderNo.trim(),
    orderDate: fromDateInput(orderDate) ?? Date.now(),
    fgItemId,
    qtyOrdered: quantity,
    status,
    customer: customer.trim() || null,
    dueDate: fromDateInput(dueDate),
    notes: notes.trim() || null
  })

  const create = useAppMutation((input: OrderInput) => window.api.orders.create(input), {
    invalidate: [qk.ordersRoot, qk.stats],
    successMessage: (result) =>
      result.duplicate ? `Order ${result.order.orderNo} already exists` : `Order ${result.order.orderNo} created`,
    onSuccess: () => closeOrderForm()
  })

  const update = useAppMutation(
    ({ id, input }: { id: string; input: Partial<OrderInput> }) => window.api.orders.update(id, input),
    {
      invalidate: [qk.ordersRoot, qk.plansRoot, qk.itemsRoot, qk.stats, qk.purchasing],
      successMessage: 'Order saved',
      onSuccess: () => closeOrderForm()
    }
  )

  const submit = (): void => {
    if (!orderNo.trim() || !fgItemId || !validQty) return
    if (editing && orderFormId) update.mutate({ id: orderFormId, input: payload() })
    else create.mutate(payload())
  }

  // Changing either of these invalidates the saved plan, so say so up front.
  const materialChange =
    editing && existing && (quantity !== existing.qtyOrdered || fgItemId !== existing.fgItemId)
  const busy = create.isPending || update.isPending
  const boxes = fg?.quantityPacked && validQty ? Math.ceil(quantity / fg.quantityPacked) : null

  return (
    <Dialog open={orderFormOpen} onOpenChange={(open) => !open && closeOrderForm()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit order ${orderNo}` : 'New order'}</DialogTitle>
          <DialogDescription>An order for a finished good. Plan it to work out what material it needs.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="orderNo">Order no.</Label>
              <Input
                id="orderNo"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="55"
                className="font-mono"
                autoFocus={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orderDate">Order date</Label>
              <Input id="orderDate" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Finished good</Label>
            <Select value={fgItemId} onValueChange={setFgItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a finished good" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {fgItems.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="font-mono text-xs">{option.code}</span>
                    <span className="ml-2 text-muted-foreground">{option.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fgItems.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No finished goods yet — add an item with type FG first.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="qty">Quantity{fg ? ` (${fg.unit})` : ''}</Label>
              <Input
                id="qty"
                value={qtyOrdered}
                onChange={(e) => setQtyOrdered(e.target.value)}
                placeholder="0"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Due date</Label>
              <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as OrderStatus)}>
                <SelectTrigger>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer">Customer</Label>
            <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Optional" />
          </div>

          {/* Live consequence of the order: what it needs, and how it ships. */}
          {fg && validQty && (
            <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {explosion?.cycle ? (
                <p className="flex items-start gap-1.5 text-destructive">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>This item&rsquo;s bill of materials loops: {explosion.cycle.join(' → ')}</span>
                </p>
              ) : explosion && explosion.lines.length === 0 ? (
                <p className="flex items-start gap-1.5 text-amber-600">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {fg.code} has no bill of materials, so this order cannot be planned yet. You can still save it.
                  </span>
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Will need</span>
                  <span>{explosion?.lines.length ?? 0} component(s)</span>
                </div>
              )}
              {boxes != null && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <PackageIcon className="size-3.5" />
                    Ships as
                  </span>
                  <span>
                    {boxes} box{boxes === 1 ? '' : 'es'}
                    {fg.quantityPacked ? ` at ${formatQty(fg.quantityPacked)}/box` : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {materialChange && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
              Changing the product or quantity clears this order&rsquo;s saved plan and releases the stock it had
              reserved. Plan it again afterwards.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="orderNotes">Notes</Label>
            <Textarea id="orderNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeOrderForm} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!orderNo.trim() || !fgItemId || !validQty || busy}>
            {editing ? 'Save changes' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
