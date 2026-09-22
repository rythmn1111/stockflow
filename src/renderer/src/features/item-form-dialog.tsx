import { useEffect, useRef, useState } from 'react'
import { InfoIcon, Loader2Icon, TrashIcon, UploadIcon } from 'lucide-react'
import type { ItemType } from '@shared/types'
import { ITEM_TYPES } from '@shared/types'
import type { ItemInput } from '@shared/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ItemSupplierEditor, type DraftLink } from '@/features/item-supplier-editor'
import { qk } from '@/lib/query-keys'
import { ACCEPTED_IMAGE_TYPES, formatBytes, preparePhoto } from '@/lib/photo'
import { useAppMutation, useItemDetail, useItemLocations, useItemRacks, usePackingBoxes, useItemUnits, useSettings } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

type FormState = {
  code: string
  name: string
  unit: string
  type: ItemType
  openingStock: string
  reorderLevel: string
  netWeight: string
  grossWeight: string
  packingBoxId: string
  quantityPacked: string
  location: string
  rack: string
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
  packingBoxId: '',
  quantityPacked: '',
  location: '',
  rack: '',
  notes: ''
}

const num = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The Item_Master sheet as a form. Every column from the workbook is here, plus the
 * things it had no room for: several suppliers, a rack within the location, and a photo.
 *
 * Fields are grouped by the feature they drive rather than by spreadsheet column order.
 */
export function ItemFormDialog(): React.JSX.Element {
  const { itemFormOpen, itemFormId, itemFormDefaults, closeItemForm } = useUiStore()
  const { data: detail } = useItemDetail(itemFormOpen ? itemFormId : null)
  const { data: units } = useItemUnits()
  const { data: locations } = useItemLocations()
  const { data: racks } = useItemRacks()
  const { data: boxes } = usePackingBoxes()
  const { data: settings } = useSettings()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [links, setLinks] = useState<DraftLink[]>([])
  const [photo, setPhoto] = useState<{ preview: string; bytes: number } | null>(null)
  const [photoPending, setPhotoPending] = useState(false)
  const [photoCleared, setPhotoCleared] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const editing = !!itemFormId

  useEffect(() => {
    if (!itemFormOpen) return
    setPhotoPending(false)
    setPhotoCleared(false)

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
        packingBoxId: item.packingBoxId ?? '',
        quantityPacked: item.quantityPacked != null ? String(item.quantityPacked) : '',
        location: item.location ?? '',
        rack: item.rack ?? '',
        notes: item.notes ?? ''
      })
      setLinks(
        detail.suppliers.map((l) => ({
          supplierId: l.supplierId,
          supplierName: l.supplierName,
          isPreferred: l.isPreferred,
          supplierSku: l.supplierSku,
          unitPrice: l.unitPrice,
          leadTimeDays: l.leadTimeDays
        }))
      )
      setPhoto(detail.photo ? { preview: detail.photo, bytes: detail.photoMeta?.bytes ?? 0 } : null)
    } else if (!editing) {
      setForm({
        ...EMPTY,
        unit: settings?.defaultUnit ?? 'Nos.',
        code: itemFormDefaults?.code ?? '',
        type: itemFormDefaults?.type ?? 'RM'
      })
      setLinks([])
      setPhoto(null)
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
    packingBoxId: form.packingBoxId || null,
    quantityPacked: num(form.quantityPacked),
    location: form.location.trim() || null,
    rack: form.rack.trim() || null,
    notes: form.notes.trim() || null,
    // Only suppliers that already exist go through here; brand-new ones are created
    // first in `persistSuppliers` below and then linked.
    suppliers: links
      .filter((l) => !l.supplierId.startsWith('new:'))
      .map((l) => ({
        supplierId: l.supplierId,
        isPreferred: l.isPreferred,
        supplierSku: l.supplierSku,
        unitPrice: l.unitPrice,
        leadTimeDays: l.leadTimeDays
      }))
  })

  /**
   * Creates any supplier typed inline, then links it. Runs after the item exists,
   * because a link needs both ends.
   */
  const persistSuppliers = async (itemId: string): Promise<void> => {
    const pending = links.filter((l) => l.supplierId.startsWith('new:'))
    for (const link of pending) {
      const extra = link as DraftLink & { pendingContact?: string | null; pendingPhone?: string | null }
      await window.api.items.createAndAttachSupplier(
        itemId,
        {
          name: link.supplierName,
          contact: extra.pendingContact ?? null,
          phone: extra.pendingPhone ?? null,
          leadTimeDays: link.leadTimeDays
        },
        { supplierSku: link.supplierSku, unitPrice: link.unitPrice, leadTimeDays: link.leadTimeDays }
      )
    }
    // Whichever row was marked preferred wins, even if it was one of the new ones.
    const preferred = links.find((l) => l.isPreferred)
    if (preferred?.supplierId.startsWith('new:')) {
      const saved = await window.api.items.suppliers(itemId)
      const match = saved.find((s) => s.supplierName === preferred.supplierName)
      if (match) await window.api.items.setPreferredSupplier(itemId, match.supplierId)
    }
  }

  const persistPhoto = async (itemId: string): Promise<void> => {
    if (photoCleared) {
      await window.api.items.removePhoto(itemId)
      return
    }
    if (!pendingPhoto.current) return
    await window.api.items.setPhoto({ itemId, ...pendingPhoto.current })
    pendingPhoto.current = null
  }

  const pendingPhoto = useRef<{
    mime: string
    thumbBase64: string
    fullBase64: string
    width: number
    height: number
  } | null>(null)

  const invalidate = [qk.itemsRoot, qk.stats, qk.itemLocations, qk.itemRacks, qk.itemUnits, qk.suppliersRoot, qk.purchasing]

  const create = useAppMutation(
    async (input: ItemInput) => {
      const result = await window.api.items.create(input)
      if (!result.duplicate) {
        await persistSuppliers(result.item.id)
        await persistPhoto(result.item.id)
      }
      return result
    },
    {
      invalidate,
      successMessage: (result) =>
        result.duplicate ? `${result.item.code} already exists` : `${result.item.code} added`,
      onSuccess: () => closeItemForm()
    }
  )

  const update = useAppMutation(
    async ({ id, input }: { id: string; input: Partial<ItemInput> }) => {
      const result = await window.api.items.update(id, input)
      await persistSuppliers(id)
      await persistPhoto(id)
      return result
    },
    {
      invalidate: [...invalidate, qk.bomRoot, qk.locationSummaries, qk.editablesBoxes],
      successMessage: 'Item saved',
      onSuccess: () => closeItemForm()
    }
  )

  const pickPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setPhotoPending(true)
    try {
      const prepared = await preparePhoto(file)
      pendingPhoto.current = {
        mime: prepared.mime,
        thumbBase64: prepared.thumbBase64,
        fullBase64: prepared.fullBase64,
        width: prepared.width,
        height: prepared.height
      }
      setPhoto({ preview: prepared.previewUrl, bytes: prepared.fullBytes })
      setPhotoCleared(false)
    } catch (err) {
      toast.error('That image could not be used', {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setPhotoPending(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = (): void => {
    if (!form.code.trim()) return
    if (editing && itemFormId) update.mutate({ id: itemFormId, input: payload() })
    else create.mutate(payload())
  }

  const gross = num(form.grossWeight)
  const net = num(form.netWeight)
  const grossBelowNet = gross != null && net != null && gross < net
  const busy = create.isPending || update.isPending || photoPending
  const typeMeta = ITEM_TYPES.find((t) => t.value === form.type)
  const openingLocked = editing && (detail?.recentMoves.length ?? 0) > 0

  return (
    <Dialog open={itemFormOpen} onOpenChange={(open) => !open && closeItemForm()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${form.code}` : 'New item'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Opening stock is the balance carried in — the ledger accumulates on top of it.'
              : 'Only the code is required. Everything else can be filled in later.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---------------- identity, photo and type ---------------- */}
          <div className="flex gap-4">
            <div className="shrink-0 space-y-1.5">
              <Label>Photo</Label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'group relative flex size-24 items-center justify-center overflow-hidden rounded-md border transition-colors',
                  photo ? 'border-border' : 'border-dashed hover:border-foreground/30'
                )}
              >
                {photoPending ? (
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                ) : photo ? (
                  <>
                    <img src={photo.preview} alt={form.code} className="size-full object-cover" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-background/70 text-xs group-hover:flex">
                      Replace
                    </span>
                  </>
                ) : (
                  <span className="flex flex-col items-center gap-1 text-muted-foreground">
                    <UploadIcon className="size-4" />
                    <span className="text-[10px]">Add photo</span>
                  </span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="hidden"
                onChange={(e) => void pickPhoto(e.target.files?.[0])}
              />
              {photo && (
                <button
                  type="button"
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setPhoto(null)
                    pendingPhoto.current = null
                    setPhotoCleared(true)
                  }}
                >
                  <TrashIcon className="size-2.5" />
                  Remove
                </button>
              )}
              {photo && photo.bytes > 0 && (
                <p className="text-[10px] text-muted-foreground">{formatBytes(photo.bytes)}</p>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
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
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(value) => set('type', value as ItemType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <span className="font-mono text-[10px] text-muted-foreground">{option.short}</span>
                          <span className="ml-2">{option.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {typeMeta && <p className="text-[11px] text-muted-foreground">{typeMeta.hint}</p>}
                </div>
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
              </div>
            </div>
          </div>

          <Separator />

          {/* ---------------------------- stock ---------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opening">Opening stock</Label>
              <Input
                id="opening"
                value={form.openingStock}
                onChange={(e) => set('openingStock', e.target.value)}
                placeholder="0"
                inputMode="decimal"
                disabled={openingLocked}
              />
              {openingLocked && (
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

          {/* --------------------- packing and weight --------------------- */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Packing &amp; weight</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Packing box</Label>
                <Select
                  value={form.packingBoxId || 'none'}
                  onValueChange={(value) => set('packingBoxId', value === 'none' ? '' : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No box chosen" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="none">No box chosen</SelectItem>
                    {(boxes ?? []).map((box) => (
                      <SelectItem key={box.id} value={box.id}>
                        {box.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Sizes are managed under <span className="font-medium">Editables</span>.
                </p>
              </div>
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

          {/* ----------------------- where it lives ----------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                list="location-options"
                placeholder="Store A"
              />
              <datalist id="location-options">
                {(locations ?? []).map((location) => (
                  <option key={location} value={location} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rack">Rack</Label>
              <Input
                id="rack"
                value={form.rack}
                onChange={(e) => set('rack', e.target.value)}
                list="rack-options"
                placeholder="R-12"
              />
              <datalist id="rack-options">
                {(racks ?? []).map((rack) => (
                  <option key={rack} value={rack} />
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground">
                Pick lists walk location first, then rack.
              </p>
            </div>
          </div>

          <Separator />

          {/* ------------------------- suppliers ------------------------- */}
          <ItemSupplierEditor links={links} onChange={setLinks} />

          <Separator />

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
            {busy && <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />}
            {editing ? 'Save changes' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
