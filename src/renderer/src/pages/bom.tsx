import { useMemo, useState } from 'react'
import {
  AlertTriangleIcon,
  CopyIcon,
  DownloadIcon,
  FactoryIcon,
  LayersIcon,
  PlusIcon,
  TrashIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { ItemCode, ItemTypeBadge } from '@/components/stock-bits'
import { qk } from '@/lib/query-keys'
import { formatQty, pluralise } from '@/lib/format'
import { useAppMutation, useBom, useExplosion, useItems } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

/**
 * The BOM_Master sheet, per finished good rather than as one flat list of rows.
 *
 * The workbook's version was a single sheet keyed on FG_Code, so seeing one product's
 * recipe meant filtering, and nothing could express a sub-assembly. Here the recipe is
 * edited in place, and the explosion preview shows what an order would actually consume
 * — including through sub-assemblies, which the one-level VLOOKUP could not follow.
 */
export function BomPage(): React.JSX.Element {
  const { data: fgResult } = useItems({ scope: 'active', type: 'FG', sort: 'code', limit: 1000 })
  const { data: allItems } = useItems({ scope: 'active', sort: 'code', limit: 2000 })
  const [selectedFg, setSelectedFg] = useState<string>('')
  const [previewQty, setPreviewQty] = useState('1')

  const fgItems = fgResult?.items ?? []
  const effectiveFg = selectedFg || fgItems[0]?.id || ''
  const { data: lines, isLoading } = useBom(effectiveFg || undefined)
  const fg = fgItems.find((i) => i.id === effectiveFg)

  const qty = Number(previewQty) || 0
  const { data: explosion } = useExplosion(effectiveFg || null, qty)

  const [newComponent, setNewComponent] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newScrap, setNewScrap] = useState('')

  const addLine = useAppMutation(
    (input: { fgItemId: string; rmItemId: string; qtyPerUnit: number; scrapPercent?: number }) =>
      window.api.bom.addLine(input),
    {
      invalidate: [qk.bomRoot, qk.ordersRoot, qk.plansRoot, qk.stats],
      successMessage: 'Component added',
      onSuccess: (result) => {
        if (result.ok) {
          setNewComponent('')
          setNewQty('')
          setNewScrap('')
        }
      }
    }
  )

  const updateLine = useAppMutation(
    ({ id, patch }: { id: string; patch: { qtyPerUnit?: number; scrapPercent?: number } }) =>
      window.api.bom.updateLine(id, patch),
    { invalidate: [qk.bomRoot, qk.ordersRoot, qk.plansRoot] }
  )

  const removeLine = useAppMutation((id: string) => window.api.bom.removeLine(id), {
    invalidate: [qk.bomRoot, qk.ordersRoot, qk.plansRoot, qk.stats],
    successMessage: 'Component removed'
  })

  const copyFrom = useAppMutation(
    ({ source, target }: { source: string; target: string }) => window.api.bom.copyFrom(source, target),
    {
      invalidate: [qk.bomRoot],
      successMessage: (result) => `Copied ${pluralise(result.copied, 'component')}`
    }
  )

  // Candidates exclude the product itself; deeper loops are caught by the main process.
  const candidates = useMemo(
    () => (allItems?.items ?? []).filter((item) => item.id !== effectiveFg && !lines?.some((l) => l.rmItemId === item.id)),
    [allItems, effectiveFg, lines]
  )

  const canAdd = !!effectiveFg && !!newComponent && Number(newQty) > 0

  if (fgItems.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          icon={FactoryIcon}
          title="No finished goods yet"
          description="A bill of materials describes what a finished good is made from. Add an item with type FG first, then list its components here."
          action={<Button onClick={() => useUiStore.getState().openItemForm(null, { type: 'FG' })}>Add a finished good</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1.5">
          <Label>Finished good</Label>
          <Select value={effectiveFg} onValueChange={setSelectedFg}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {fgItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span className="font-mono text-xs">{item.code}</span>
                  <span className="ml-2 text-muted-foreground">{item.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Select
          value=""
          onValueChange={(value) => value && copyFrom.mutate({ source: value, target: effectiveFg })}
        >
          <SelectTrigger className="w-52">
            <span className="flex items-center gap-1.5 text-sm">
              <CopyIcon className="size-3.5" />
              Copy from another product
            </span>
          </SelectTrigger>
          <SelectContent>
            {fgItems
              .filter((item) => item.id !== effectiveFg)
              .map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.code}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <Button variant="outline" className="ml-auto gap-1.5" onClick={() => void window.api.bom.exportCsv()}>
          <DownloadIcon className="size-3.5" />
          Export all
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              Components of {fg?.code}
              {!!lines?.length && (
                <Badge variant="muted" className="h-4 px-1 text-[10px]">
                  {lines.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-32" />
            ) : !lines?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No components yet. Add the first one below — quantities are per one unit of {fg?.code}.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead className="w-14">Type</TableHead>
                    <TableHead className="w-28 text-right">Per unit</TableHead>
                    <TableHead className="w-20 text-right">Scrap %</TableHead>
                    <TableHead className="w-28">Supplier</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <ItemCode code={line.rmCode} />
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{line.rmName}</TableCell>
                      <TableCell>
                        <ItemTypeBadge type={line.rmType} />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineNumber
                          value={line.qtyPerUnit}
                          suffix={line.rmUnit}
                          onCommit={(value) =>
                            value > 0 && updateLine.mutate({ id: line.id, patch: { qtyPerUnit: value } })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineNumber
                          value={line.scrapPercent}
                          suffix="%"
                          onCommit={(value) => updateLine.mutate({ id: line.id, patch: { scrapPercent: value } })}
                        />
                      </TableCell>
                      <TableCell className="max-w-28 truncate text-xs text-muted-foreground">
                        {line.supplierName ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeLine.mutate(line.id)}
                            >
                              <TrashIcon className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Separator />

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1 space-y-1.5">
                <Label className="text-xs">Add component</Label>
                <Select value={newComponent} onValueChange={setNewComponent}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Choose an item" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {candidates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        <span className="font-mono text-xs">{item.code}</span>
                        <span className="ml-2 text-muted-foreground">{item.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-24 space-y-1.5">
                <Label className="text-xs">Per unit</Label>
                <Input
                  className="h-8"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder="1"
                  inputMode="decimal"
                />
              </div>
              <div className="w-24 space-y-1.5">
                <Label className="text-xs">Scrap %</Label>
                <Input
                  className="h-8"
                  value={newScrap}
                  onChange={(e) => setNewScrap(e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={!canAdd || addLine.isPending}
                onClick={() =>
                  addLine.mutate({
                    fgItemId: effectiveFg,
                    rmItemId: newComponent,
                    qtyPerUnit: Number(newQty),
                    scrapPercent: Number(newScrap) || 0
                  })
                }
              >
                <PlusIcon className="size-3.5" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* The explosion preview: what an order for N of this would consume. */}
        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <LayersIcon className="size-3.5" />
              Requirement preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">If we order this many</Label>
              <Input value={previewQty} onChange={(e) => setPreviewQty(e.target.value)} inputMode="decimal" className="h-8" />
            </div>

            {explosion?.cycle ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
                <p className="flex items-start gap-1.5">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    This bill of materials contains a loop: {explosion.cycle.join(' → ')}. Remove one of those lines.
                  </span>
                </p>
              </div>
            ) : !explosion?.lines.length ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Add components to see what an order would need.
              </p>
            ) : (
              <div className="space-y-1">
                {explosion.lines.map((line) => (
                  <div key={line.itemId} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      {/* Indentation shows how deep in the tree the part sits. */}
                      <span style={{ paddingLeft: `${(line.depth - 1) * 10}px` }}>
                        <ItemCode code={line.code} />
                      </span>
                      {line.depth > 1 && (
                        <Badge variant="muted" className="h-3.5 px-1 text-[9px]">
                          L{line.depth}
                        </Badge>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatQty(line.qty, line.unit)}</span>
                  </div>
                ))}
                <Separator className="my-2" />
                <p className="text-[11px] text-muted-foreground">
                  {pluralise(explosion.lines.length, 'part')} to issue.
                  {explosion.lines.some((l) => l.depth > 1) && ' Sub-assemblies are followed through to their parts.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** Click-to-edit number, so a quantity fix does not need a dialog. */
function InlineNumber({
  value,
  suffix,
  onCommit
}: {
  value: number
  suffix?: string
  onCommit: (value: number) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  if (!editing) {
    return (
      <button
        className={cn('tabular-nums underline-offset-2 hover:underline', value === 0 && 'text-muted-foreground')}
        onClick={() => {
          setDraft(String(value))
          setEditing(true)
        }}
      >
        {suffix === '%' ? (value > 0 ? `${value}%` : '—') : formatQty(value, suffix)}
      </button>
    )
  }

  const commit = (): void => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
    setEditing(false)
  }

  return (
    <Input
      autoFocus
      className="h-7 w-20 text-right"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      inputMode="decimal"
    />
  )
}
