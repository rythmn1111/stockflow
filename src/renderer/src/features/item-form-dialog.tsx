import { useEffect, useState } from 'react'
import type { ItemType } from '@shared/types'
import type { ItemInput } from '@shared/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { InfoIcon } from 'lucide-react'
import { qk } from '@/lib/query-keys'
import { useAppMutation, useItemDetail, useItemLocations, useItemUnits, useSettings, useSuppliers } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'

type FormState = {
  code: string
  name: string
  unit: string
  type: ItemType
  openingStock: string
  reorderLevel: string
  netWeight: string
  grossWeight: string
  packingBoxDetails: string
  quantityPacked: string
  location: string
  supplierId: string
  notes: string
}

const EMPTY: FormState = {
  code: '',
  name: '',
  unit: 'Nos.',
  type: 'RM',
  openingStock: '',
  reorderLevel: '',
  netWeight: '',
  grossWeight: '',
  packingBoxDetails: '',
  quantityPacked: '',
  location: '',
  supplierId: '',
  notes: ''
}

const num = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The Item_Master sheet as a form. Every column from the workbook is here, grouped so
 * the fields that drive a feature sit next to the thing they drive — reorder level with
 * stock, packing with weight — rather than in spreadsheet column order.
 */
export function ItemFormDialog(): React.JSX.Element {
  const { itemFormOpen, itemFormId, itemFormDefaults, closeItemForm } = useUiStore()
  const { data: detail } = useItemDetail(itemFormOpen ? itemFormId : null)
  const { data: suppliers } = useSuppliers()
  const { data: units } = useItemUnits()
  const { data: locations } = useItemLocations()
  const { data: settings } = useSettings()
  const [form, setForm] = useState<FormState>(EMPTY)

  const editing = !!itemFormId

  useEffect(() => {
    if (!itemFormOpen) return
    if (editing && detail) {
      const item = detail.item
      setForm({
        code: item.code,
        name: item.name,
        unit: item.unit,
        type: item.type,
        openingStock: String(item.openingStock),
        reorderLevel: item.reorderLevel ? String(item.reorderLevel) : '',
        netWeight: item.netWeight != null ? String(item.netWeight) : '',
        grossWeight: item.grossWeight != null ? String(item.grossWeight) : '',
        packingBoxDetails: item.packingBoxDetails ?? '',
        quantityPacked: item.quantityPacked != null ? String(item.quantityPacked) : '',
        location: item.location ?? '',
        supplierId: item.supplierId ?? '',
        notes: item.notes ?? ''
      })
    } else if (!editing) {
      setForm({
        ...EMPTY,
        unit: settings?.defaultUnit ?? 'Nos.',
        code: itemFormDefaults?.code ?? '',
        type: itemFormDefaults?.type ?? 'RM'
      })
    }
  }, [itemFormOpen, editing, detail, itemFormDefaults, settings?.defaultUnit])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const payload = (): ItemInput => ({
    code: form.code.trim(),
    name: form.name.trim() || form.code.trim(),
    unit: form.unit.trim() || 'Nos.',
    type: form.type,
    openingStock: num(form.openingStock) ?? 0,
    reorderLevel: num(form.reorderLevel) ?? 0,
    netWeight: num(form.netWeight),
    grossWeight: num(form.grossWeight),
    packingBoxDetails: form.packingBoxDetails.trim() || null,
    quantityPacked: num(form.quantityPacked),
    location: form.location.trim() || null,
    supplierId: form.supplierId || null,
    notes: form.notes.trim() || null
  })

  const create = useAppMutation((input: ItemInput) => window.api.items.create(input), {
    invalidate: [qk.itemsRoot, qk.stats, qk.itemLocations, qk.itemUnits],
    successMessage: (result) =>
      result.duplicate ? `${result.item.code} already exists — opened the existing item` : `${result.item.code} added`,
    onSuccess: () => closeItemForm()
  })

  const update = useAppMutation(
    ({ id, input }: { id: string; input: Partial<ItemInput> }) => window.api.items.update(id, input),
    {
      invalidate: [qk.itemsRoot, qk.stats, qk.bomRoot, qk.itemLocations, qk.itemUnits, qk.locationSummaries],
      successMessage: 'Item saved',
      onSuccess: () => closeItemForm()
    }
  )

  const submit = (): void => {
    if (!form.code.trim()) return
    if (editing && itemFormId) update.mutate({ id: itemFormId, input: payload() })
    else create.mutate(payload())
  }

  const gross = num(form.grossWeight)
  const net = num(form.netWeight)
  const grossBelowNet = gross != null && net != null && gross < net
  const busy = create.isPending || update.isPending

  return (
    <Dialog open={itemFormOpen} onOpenChange={(open) => !open && closeItemForm()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${form.code}` : 'New item'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Opening stock is the balance carried in — the ledger accumulates on top of it.'
              : 'A raw material or a finished good. Only the code is required.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* --- identity --- */}
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="code">Item code</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => set('code', e.target.value)}
                placeholder="RM-01"
                className="font-mono"
                autoFocus={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Item name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Defaults to the code"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <ToggleGroup
                type="single"
                value={form.type}
                onValueChange={(value) => value && set('type', value as ItemType)}
              >
                <ToggleGroupItem value="RM" className="px-3">RM</ToggleGroupItem>
                <ToggleGroupItem value="FG" className="px-3">FG</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <Separator />

          {/* --- stock --- */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                list="unit-options"
                placeholder="Nos."
              />
              <datalist id="unit-options">
                {(units ?? []).map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opening">Opening stock</Label>
              <Input
                id="opening"
                value={form.openingStock}
                onChange={(e) => set('openingStock', e.target.value)}
                placeholder="0"
                inputMode="decimal"
                disabled={editing && (detail?.recentMoves.length ?? 0) > 0}
              />
              {editing && (detail?.recentMoves.length ?? 0) > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Locked — this item has ledger entries. Correct stock with an adjustment instead.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reorder" className="flex items-center gap-1">
                Reorder level
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="size-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Alerts when free stock drops to this. Leave blank for no alert — zero means
                    &ldquo;not configured&rdquo;, not &ldquo;warn me at nothing left&rdquo;.
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="reorder"
                value={form.reorderLevel}
                onChange={(e) => set('reorderLevel', e.target.value)}
                placeholder="No alert"
                inputMode="decimal"
              />
            </div>
          </div>

          <Separator />

          {/* --- packing and weight: the fields that drive cartons and freight --- */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Packing &amp; weight</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qtyPacked">Quantity packed (per box)</Label>
                <Input
                  id="qtyPacked"
                  value={form.quantityPacked}
                  onChange={(e) => set('quantityPacked', e.target.value)}
                  placeholder="e.g. 24"
                  inputMode="decimal"
                />
                <p className="text-[11px] text-muted-foreground">Drives the carton count on every order.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="boxDetails">Packing box details</Label>
                <Input
                  id="boxDetails"
                  value={form.packingBoxDetails}
                  onChange={(e) => set('packingBoxDetails', e.target.value)}
                  placeholder="Carton 300×200×150"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="net">Net weight (kg per unit)</Label>
                <Input
                  id="net"
                  value={form.netWeight}
                  onChange={(e) => set('netWeight', e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gross">Gross weight (kg per unit)</Label>
                <Input
                  id="gross"
                  value={form.grossWeight}
                  onChange={(e) => set('grossWeight', e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  aria-invalid={grossBelowNet}
                />
                {grossBelowNet && (
                  <p className="text-[11px] text-destructive">
                    Gross is below net — packaging cannot weigh less than nothing.
                  </p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* --- where it is and who sells it --- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                list="location-options"
                placeholder="A-1"
              />
              <datalist id="location-options">
                {(locations ?? []).map((location) => (
                  <option key={location} value={location} />
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground">Groups pick lists so the store is walked once.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <Select value={form.supplierId || 'none'} onValueChange={(value) => set('supplierId', value === 'none' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="No supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No supplier</SelectItem>
                  {(suppliers ?? []).map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                      {supplier.contact ? ` — ${supplier.contact}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Anything worth remembering about this part"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeItemForm} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!form.code.trim() || busy}>
            {editing ? 'Save changes' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
