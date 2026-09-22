import { useState } from 'react'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BoxIcon,
  ChevronDownIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon
} from 'lucide-react'
import type { PackingBox } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { qk } from '@/lib/query-keys'
import { formatQty, formatWeight, pluralise } from '@/lib/format'
import { useAppMutation, usePackingBoxes, usePackingBoxItems } from '@/hooks/use-data'
import { cn } from '@/lib/utils'

/**
 * Editables: the lists that feed dropdowns elsewhere in the app.
 *
 * Packing boxes are the first. The workbook had `Packing Box Details` as free text per
 * item, so the same carton existed as three different strings and nothing could count
 * how many of each you needed. Defined once here, it becomes a real choice with real
 * dimensions.
 */
export function EditablesPage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div>
        <h1 className="text-sm font-medium">Editables</h1>
        <p className="text-xs text-muted-foreground">
          Lists you define once and then choose from when adding items. Keeping them as lists means the same thing is
          always spelled the same way, and can be counted.
        </p>
      </div>
      <PackingBoxesSection />
    </div>
  )
}

function PackingBoxesSection(): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false)
  const { data: boxes, isLoading } = usePackingBoxes(showArchived)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const invalidate = [qk.editablesBoxes, qk.itemsRoot, qk.ordersRoot]

  const create = useAppMutation(
    (input: { label: string; lengthMm: number | null; widthMm: number | null; heightMm: number | null; emptyWeight: number | null }) =>
      window.api.editables.packingBoxes.create(input),
    {
      invalidate,
      successMessage: (result) => (result.box ? `${result.box.label} added` : null),
      onSuccess: (result) => {
        if (result.ok) setAdding(false)
      }
    }
  )

  const update = useAppMutation(
    ({ id, patch }: { id: string; patch: Parameters<typeof window.api.editables.packingBoxes.update>[1] }) =>
      window.api.editables.packingBoxes.update(id, patch),
    {
      invalidate,
      successMessage: 'Box updated',
      onSuccess: (result) => {
        if (result.ok) setEditing(null)
      }
    }
  )

  const remove = useAppMutation((id: string) => window.api.editables.packingBoxes.remove(id), {
    invalidate,
    successMessage: 'Box removed'
  })

  const active = boxes ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BoxIcon className="size-3.5" />
          Packing box sizes
          {active.length > 0 && (
            <Badge variant="muted" className="h-4 px-1 text-[10px]">
              {active.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Chosen on each item, and used to work out how many cartons an order ships as.
          </p>
          <div className="flex items-center gap-1.5">
            <Switch id="archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="archived" className="text-xs text-muted-foreground">
              Show archived
            </Label>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-32" />
        ) : active.length === 0 ? (
          <EmptyState
            icon={BoxIcon}
            title="No box sizes yet"
            description="Add the cartons and crates you pack in. Each one becomes a choice on the item form."
            action={<Button onClick={() => setAdding(true)}>Add a box size</Button>}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Dimensions</TableHead>
                <TableHead className="w-24 text-right">Empty weight</TableHead>
                <TableHead className="w-24 text-right">Used by</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((box) =>
                editing === box.id ? (
                  <TableRow key={box.id}>
                    <TableCell colSpan={5} className="p-0">
                      <BoxForm
                        initial={box}
                        busy={update.isPending}
                        onCancel={() => setEditing(null)}
                        onSubmit={(values) => update.mutate({ id: box.id, patch: values })}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={box.id} className={cn(box.archivedAt && 'opacity-50')}>
                    <TableCell className="font-medium">
                      {box.label}
                      {box.archivedAt && (
                        <Badge variant="muted" className="ml-2 h-4 px-1 text-[10px]">
                          archived
                        </Badge>
                      )}
                      {box.notes && <p className="text-[11px] text-muted-foreground">{box.notes}</p>}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {box.lengthMm != null && box.widthMm != null && box.heightMm != null
                        ? `${box.lengthMm} × ${box.widthMm} × ${box.heightMm} mm`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatWeight(box.emptyWeight)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {box.itemCount > 0 ? <BoxUsage box={box} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(box.id)}>
                              <PencilIcon className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => update.mutate({ id: box.id, patch: { archived: !box.archivedAt } })}
                            >
                              {box.archivedAt ? (
                                <ArchiveRestoreIcon className="size-3.5" />
                              ) : (
                                <ArchiveIcon className="size-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {box.archivedAt
                              ? 'Restore to the dropdown'
                              : 'Hide from new items, keep on existing ones'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => remove.mutate(box.id)}
                            >
                              <TrashIcon className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {box.itemCount > 0 ? 'In use — archive it instead' : 'Delete'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}

        {adding ? (
          <BoxForm busy={create.isPending} onCancel={() => setAdding(false)} onSubmit={(values) => create.mutate(values)} />
        ) : (
          active.length > 0 && (
            <>
              <Separator />
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
                <PlusIcon className="size-3.5" />
                Add a box size
              </Button>
            </>
          )
        )}
      </CardContent>
    </Card>
  )
}

/** Which items use a box — the answer to "is it safe to change this?" */
function BoxUsage({ box }: { box: PackingBox }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { data: items } = usePackingBoxItems(open ? box.id : null)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
          {pluralise(box.itemCount, 'item')}
          <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 text-left">
        {(items ?? []).map((item) => (
          <p key={item.id} className="text-[11px] text-muted-foreground">
            <span className="font-mono">{item.code}</span>
            {item.quantityPacked != null ? ` · ${formatQty(item.quantityPacked)}/box` : ''}
          </p>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function BoxForm({
  initial,
  busy,
  onCancel,
  onSubmit
}: {
  initial?: PackingBox
  busy: boolean
  onCancel: () => void
  onSubmit: (values: {
    label: string
    lengthMm: number | null
    widthMm: number | null
    heightMm: number | null
    emptyWeight: number | null
  }) => void
}): React.JSX.Element {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [length, setLength] = useState(initial?.lengthMm != null ? String(initial.lengthMm) : '')
  const [width, setWidth] = useState(initial?.widthMm != null ? String(initial.widthMm) : '')
  const [height, setHeight] = useState(initial?.heightMm != null ? String(initial.heightMm) : '')
  const [weight, setWeight] = useState(initial?.emptyWeight != null ? String(initial.emptyWeight) : '')

  const num = (value: string): number | null => {
    const parsed = Number(value.trim())
    return value.trim() && Number.isFinite(parsed) ? parsed : null
  }

  // Dimensions alone are enough: the name is generated from them.
  const derived = num(length) != null && num(width) != null && num(height) != null
  const canSubmit = !!label.trim() || derived

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <ListIcon className="size-3.5" />
        {initial ? `Edit ${initial.label}` : 'New box size'}
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_repeat(4,1fr)]">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Name</Label>
          <Input
            className="h-8"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={derived ? 'From dimensions' : 'Carton 300×200×150'}
            autoFocus
          />
        </div>
        {(
          [
            ['Length', length, setLength],
            ['Width', width, setWidth],
            ['Height', height, setHeight]
          ] as const
        ).map(([name, value, setter]) => (
          <div key={name} className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{name} (mm)</Label>
            <Input className="h-8" value={value} onChange={(e) => setter(e.target.value)} inputMode="decimal" />
          </div>
        ))}
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Empty (kg)</Label>
          <Input className="h-8" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        The empty weight is added to shipping weight once per carton, so a freight figure includes the packaging.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7"
          disabled={!canSubmit || busy}
          onClick={() =>
            onSubmit({
              label: label.trim(),
              lengthMm: num(length),
              widthMm: num(width),
              heightMm: num(height),
              emptyWeight: num(weight)
            })
          }
        >
          {initial ? 'Save' : 'Add'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
