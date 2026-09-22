import { useState } from 'react'
import { PlusIcon, StarIcon, TrashIcon, TruckIcon, UserPlusIcon, XIcon } from 'lucide-react'
import type { Supplier } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PreferredBadge } from '@/components/stock-bits'
import { useSuppliers } from '@/hooks/use-data'
import { cn } from '@/lib/utils'

/** One row of the editor: a supplier plus what they charge for this part. */
export interface DraftLink {
  supplierId: string
  supplierName: string
  isPreferred: boolean
  supplierSku: string | null
  unitPrice: number | null
  leadTimeDays: number | null
}

/**
 * The supplier section of the item form.
 *
 * Two things the workbook made impossible: a part can have several suppliers, and a new
 * supplier can be created here rather than forcing a trip to the Suppliers page and
 * back. It is deliberately state-only — the parent decides when to save, so this works
 * identically whether the item exists yet or not.
 */
export function ItemSupplierEditor({
  links,
  onChange
}: {
  links: DraftLink[]
  onChange: (links: DraftLink[]) => void
}): React.JSX.Element {
  const { data: suppliers } = useSuppliers()
  const [picking, setPicking] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', contact: '', phone: '', leadTimeDays: '' })

  const available = (suppliers ?? []).filter((s) => !links.some((l) => l.supplierId === s.id))

  const add = (supplier: Supplier): void => {
    onChange([
      ...links,
      {
        supplierId: supplier.id,
        supplierName: supplier.name,
        // The first supplier is preferred by definition; there is nothing to compare it to.
        isPreferred: links.length === 0,
        supplierSku: null,
        unitPrice: null,
        leadTimeDays: null
      }
    ])
    setPicking('')
  }

  const addNew = (): void => {
    const name = draft.name.trim()
    if (!name) return
    // Not saved yet — the parent creates it on submit, so cancelling the dialog leaves
    // no half-made supplier behind.
    onChange([
      ...links,
      {
        supplierId: `new:${name}`,
        supplierName: name,
        isPreferred: links.length === 0,
        supplierSku: null,
        unitPrice: null,
        leadTimeDays: draft.leadTimeDays ? Number(draft.leadTimeDays) : null,
        ...({ pendingContact: draft.contact.trim() || null, pendingPhone: draft.phone.trim() || null } as object)
      } as DraftLink
    ])
    setDraft({ name: '', contact: '', phone: '', leadTimeDays: '' })
    setCreating(false)
  }

  const patch = (supplierId: string, changes: Partial<DraftLink>): void =>
    onChange(links.map((l) => (l.supplierId === supplierId ? { ...l, ...changes } : l)))

  const remove = (supplierId: string): void => {
    const next = links.filter((l) => l.supplierId !== supplierId)
    // Something always has to lead, so removing the preferred one promotes the first left.
    if (next.length && !next.some((l) => l.isPreferred)) next[0]!.isPreferred = true
    onChange(next)
  }

  const setPreferred = (supplierId: string): void =>
    onChange(links.map((l) => ({ ...l, isPreferred: l.supplierId === supplierId })))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <TruckIcon className="size-3.5" />
          Suppliers
          {links.length > 1 && (
            <Badge variant="muted" className="h-4 px-1 text-[10px]">
              {links.length}
            </Badge>
          )}
        </Label>
      </div>

      {links.length === 0 && !creating && (
        <p className="text-[11px] text-muted-foreground">
          A part with no supplier can never appear on a purchase list. Add one or more below.
        </p>
      )}

      {links.map((link) => (
        <div key={link.supplierId} className="rounded-md border p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {link.supplierName}
              {link.supplierId.startsWith('new:') && (
                <Badge variant="muted" className="ml-1.5 h-4 px-1 text-[10px]">
                  new
                </Badge>
              )}
            </span>
            {link.isPreferred ? (
              <PreferredBadge />
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    onClick={() => setPreferred(link.supplierId)}
                  >
                    <StarIcon className="size-3" />
                    Make preferred
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-xs">
                  Shortages for this part will be grouped under this supplier instead.
                </TooltipContent>
              </Tooltip>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => remove(link.supplierId)}
            >
              <TrashIcon className="size-3" />
            </Button>
          </div>

          {/* What differs per vendor — the reason to hold more than one. */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Their part no.</Label>
              <Input
                className="h-7 text-xs"
                value={link.supplierSku ?? ''}
                onChange={(e) => patch(link.supplierId, { supplierSku: e.target.value || null })}
                placeholder="—"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Unit price</Label>
              <Input
                className="h-7 text-xs"
                value={link.unitPrice ?? ''}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  patch(link.supplierId, {
                    unitPrice: e.target.value.trim() && Number.isFinite(value) ? value : null
                  })
                }}
                placeholder="—"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Lead days</Label>
              <Input
                className="h-7 text-xs"
                value={link.leadTimeDays ?? ''}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  patch(link.supplierId, {
                    leadTimeDays: e.target.value.trim() && Number.isFinite(value) ? value : null
                  })
                }}
                placeholder="default"
                inputMode="numeric"
              />
            </div>
          </div>
        </div>
      ))}

      {creating ? (
        <div className="space-y-2 rounded-md border border-dashed p-2.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">New supplier</Label>
            <Button variant="ghost" size="icon" className="size-6" onClick={() => setCreating(false)}>
              <XIcon className="size-3" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              className="h-8"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && addNew()}
            />
            <Input
              className="h-8"
              value={draft.contact}
              onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
              placeholder="Contact"
            />
            <Input
              className="h-8"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="Phone"
            />
            <Input
              className="h-8"
              value={draft.leadTimeDays}
              onChange={(e) => setDraft({ ...draft, leadTimeDays: e.target.value })}
              placeholder="Lead time (days)"
              inputMode="numeric"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Created when you save the item. A name that already exists is reused rather than duplicated.
          </p>
          <Button size="sm" className="h-7 gap-1" disabled={!draft.name.trim()} onClick={addNew}>
            <PlusIcon className="size-3" />
            Add to this item
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={picking}
            onValueChange={(value) => {
              const supplier = available.find((s) => s.id === value)
              if (supplier) add(supplier)
            }}
          >
            <SelectTrigger className={cn('h-8 flex-1', !available.length && 'opacity-60')}>
              <SelectValue placeholder={available.length ? 'Add an existing supplier' : 'All suppliers added'} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {available.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.name}
                  {supplier.contact ? ` — ${supplier.contact}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
            <UserPlusIcon className="size-3.5" />
            New supplier
          </Button>
        </div>
      )}

      {links.length > 1 && (
        <>
          <Separator />
          <p className="text-[11px] text-muted-foreground">
            {links.find((l) => l.isPreferred)?.supplierName} is the preferred source, so this part&rsquo;s shortages
            appear under them. The other {links.length - 1} {links.length === 2 ? 'is an' : 'are'} alternative
            {links.length === 2 ? '' : 's'} you can fall back on.
          </p>
        </>
      )}
    </div>
  )
}
