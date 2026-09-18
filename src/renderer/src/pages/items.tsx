import { useEffect, useRef } from 'react'
import {
  ArrowDownUpIcon,
  BoxesIcon,
  DownloadIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  XIcon
} from 'lucide-react'
import type { ItemType } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ItemCode, ItemTypeBadge, StockCell } from '@/components/stock-bits'
import { ItemDetailSheet } from '@/features/item-detail-sheet'
import { useItemLocations, useItems, useSuppliers } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { formatQty, formatWeight, pluralise } from '@/lib/format'
import { cn } from '@/lib/utils'

const STOCK_FILTERS = [
  { value: 'all', label: 'All stock' },
  { value: 'below_reorder', label: 'Below reorder' },
  { value: 'negative', label: 'Negative' },
  { value: 'zero', label: 'Zero' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'no_reorder_level', label: 'No reorder level' }
] as const

const SORTS = [
  { value: 'code', label: 'Code' },
  { value: 'name', label: 'Name' },
  { value: 'stock_asc', label: 'Least stock' },
  { value: 'stock_desc', label: 'Most stock' },
  { value: 'shortfall', label: 'Furthest below reorder' },
  { value: 'recent', label: 'Recently changed' }
] as const

/**
 * The Item_Master sheet, with the Stock_Register sheet folded into it.
 *
 * Keeping them separate was the workbook's biggest structural problem: two lists of the
 * same items, joined by hand, with 774 rows of SUMIFS keeping one in step with the
 * other. Here stock is a computed column on the master itself.
 */
export function ItemsPage(): React.JSX.Element {
  const { itemFilters, setItemFilters, resetItemFilters, openItemForm, openMoveForm, setOpenItem, openItemId, searchFocusToken } =
    useUiStore()
  const { data, isLoading, isPlaceholderData } = useItems(itemFilters)
  const { data: suppliers } = useSuppliers()
  const { data: locations } = useItemLocations()
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchFocusToken > 0) searchRef.current?.focus()
  }, [searchFocusToken])

  const items = data?.items ?? []
  const filtered =
    !!itemFilters.search ||
    itemFilters.type !== 'all' ||
    (itemFilters.stockFilter && itemFilters.stockFilter !== 'all') ||
    !!itemFilters.supplierIds?.length ||
    !!itemFilters.locations?.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={itemFilters.search ?? ''}
            onChange={(e) => setItemFilters({ search: e.target.value })}
            placeholder="Search code, name, location, notes…"
            className="h-8 pl-8"
          />
        </div>

        <Select
          value={itemFilters.type ?? 'all'}
          onValueChange={(value) => setItemFilters({ type: value as ItemType | 'all' })}
        >
          <SelectTrigger className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">RM &amp; FG</SelectItem>
            <SelectItem value="RM">Raw material</SelectItem>
            <SelectItem value="FG">Finished good</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={itemFilters.stockFilter ?? 'all'}
          onValueChange={(value) => setItemFilters({ stockFilter: value as never })}
        >
          <SelectTrigger className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STOCK_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={itemFilters.supplierIds?.[0] ?? 'all'}
          onValueChange={(value) => setItemFilters({ supplierIds: value === 'all' ? [] : [value] })}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder="Supplier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any supplier</SelectItem>
            {(suppliers ?? []).map((supplier) => (
              <SelectItem key={supplier.id} value={supplier.id}>
                {supplier.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={itemFilters.locations?.[0] ?? 'all'}
          onValueChange={(value) => setItemFilters({ locations: value === 'all' ? [] : [value] })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any location</SelectItem>
            {(locations ?? []).map((location) => (
              <SelectItem key={location} value={location}>
                {location}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={itemFilters.sort ?? 'code'} onValueChange={(value) => setItemFilters({ sort: value as never })}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                Sort: {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={resetItemFilters}>
            <XIcon className="size-3" />
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void window.api.items.exportCsv()}>
            <DownloadIcon className="size-3.5" />
            Export
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => openItemForm()}>
            <PlusIcon className="size-3.5" />
            New item
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground">
        <span>
          {data ? pluralise(data.total, 'item') : '…'}
          {itemFilters.scope === 'archived' && ' · archived'}
        </span>
        <button
          className="underline-offset-2 hover:underline"
          onClick={() => setItemFilters({ scope: itemFilters.scope === 'archived' ? 'active' : 'archived' })}
        >
          {itemFilters.scope === 'archived' ? 'Show active' : 'Show archived'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={BoxesIcon}
            title={filtered ? 'Nothing matches those filters' : 'No items yet'}
            description={
              filtered
                ? 'Try clearing a filter, or widen the search.'
                : 'Add your raw materials and finished goods to get started.'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={resetItemFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => openItemForm()}>Add an item</Button>
              )
            }
          />
        ) : (
          <Table className={cn(isPlaceholderData && 'opacity-60')}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-14">Type</TableHead>
                <TableHead className="w-36 text-right">Stock</TableHead>
                <TableHead className="w-20 text-right">Reorder</TableHead>
                <TableHead className="w-24">Location</TableHead>
                <TableHead className="w-32">Supplier</TableHead>
                <TableHead className="w-24 text-right">Net wt.</TableHead>
                <TableHead className="w-16 text-right">Per box</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer"
                  onClick={() => setOpenItem(item.id)}
                >
                  <TableCell>
                    <ItemCode code={item.code} />
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {item.name}
                    {item.archivedAt && (
                      <Badge variant="muted" className="ml-2 h-4 px-1 text-[10px]">
                        archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ItemTypeBadge type={item.type} />
                  </TableCell>
                  <TableCell className="text-right">
                    <StockCell
                      currentStock={item.currentStock}
                      committed={item.committed}
                      freeStock={item.freeStock}
                      unit={item.unit}
                      reorderLevel={item.reorderLevel}
                      belowReorder={item.belowReorder}
                    />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {item.reorderLevel > 0 ? formatQty(item.reorderLevel) : '—'}
                  </TableCell>
                  <TableCell className="text-xs">
                    {item.location ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <MapPinIcon className="size-3" />
                        {item.location}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-32 truncate text-xs text-muted-foreground">
                    {item.supplierName ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatWeight(item.netWeight)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {item.quantityPacked != null ? formatQty(item.quantityPacked) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => openMoveForm({ itemId: item.id })}
                          >
                            <ArrowDownUpIcon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Record a movement</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => openItemForm(item.id)}>
                            <PencilIcon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ItemDetailSheet itemId={openItemId} onClose={() => setOpenItem(null)} />
    </div>
  )
}
