import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, ImageIcon, PackageIcon, StarIcon } from 'lucide-react'
import type { ItemType, MoveDirection, OrderStatus } from '@shared/types'
import { ITEM_TYPES } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatQty, ORDER_STATUS_LABELS } from '@/lib/format'

/** Small display pieces shared across the stock screens. */

/** One colour per type, so the six are distinguishable at a glance in a long list. */
const TYPE_TONE: Record<ItemType, string> = {
  RM: 'border-cyan-500/40 text-cyan-500',
  WIP: 'border-amber-500/40 text-amber-600',
  FG: 'border-violet-500/40 text-violet-500',
  BOUGHT_OUT: 'border-blue-500/40 text-blue-500',
  CONSUMABLE: 'border-emerald-500/40 text-emerald-500',
  ASSET: 'border-muted-foreground/40 text-muted-foreground'
}

export function ItemTypeBadge({ type }: { type: ItemType }): React.JSX.Element {
  const meta = ITEM_TYPES.find((t) => t.value === type)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('h-5 px-1.5 font-mono text-[10px] tracking-wide', TYPE_TONE[type])}>
          {meta?.short ?? type}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-56 text-xs">
        <p className="font-medium">{meta?.label ?? type}</p>
        {meta?.hint && <p className="text-muted-foreground">{meta.hint}</p>}
      </TooltipContent>
    </Tooltip>
  )
}

/** The item's picture, or a neutral placeholder so rows keep their alignment. */
export function ItemThumb({
  src,
  alt,
  size = 28,
  className
}: {
  src: string | null
  alt: string
  size?: number
  className?: string
}): React.JSX.Element {
  if (!src) {
    return (
      <div
        className={cn('flex shrink-0 items-center justify-center rounded border bg-muted/40', className)}
        style={{ width: size, height: size }}
      >
        <ImageIcon className="size-3 text-muted-foreground/50" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn('shrink-0 rounded border object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}

/** Marks the supplier a shortage will be grouped under. */
export function PreferredBadge({ className }: { className?: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="success" className={cn('h-4 gap-0.5 px-1 text-[10px]', className)}>
          <StarIcon className="size-2.5" />
          preferred
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">
        Shortages for this part are grouped under this supplier on the purchase list. The others are
        alternatives you can fall back on.
      </TooltipContent>
    </Tooltip>
  )
}

export function ItemCode({ code, className }: { code: string; className?: string }): React.JSX.Element {
  return <span className={cn('font-mono text-xs font-medium', className)}>{code}</span>
}

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: 'border-muted-foreground/30 text-muted-foreground',
  planned: 'border-blue-500/40 text-blue-500',
  in_production: 'border-amber-500/40 text-amber-600',
  completed: 'border-emerald-500/40 text-emerald-500',
  cancelled: 'border-muted-foreground/20 text-muted-foreground/60 line-through'
}

export function OrderStatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', STATUS_TONE[status])}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

export function DirectionIcon({ direction }: { direction: MoveDirection }): React.JSX.Element {
  return direction === 'in' ? (
    <ArrowDownIcon className="size-3.5 text-emerald-500" aria-label="Inward" />
  ) : (
    <ArrowUpIcon className="size-3.5 text-amber-600" aria-label="Outward" />
  )
}

/**
 * The stock figure, and why it is what it is.
 *
 * On-hand and free diverge the moment an order is planned, and that difference is the
 * whole point of the commitment model — so where they differ, the tooltip spells the
 * arithmetic out rather than leaving the user to wonder which number to trust.
 */
export function StockCell({
  currentStock,
  committed,
  freeStock,
  unit,
  reorderLevel,
  belowReorder
}: {
  currentStock: number
  committed: number
  freeStock: number
  unit: string
  reorderLevel: number
  belowReorder: boolean
}): React.JSX.Element {
  const hasCommitment = committed > 0
  const negative = currentStock < 0

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex items-center gap-1.5 tabular-nums">
          <span className={cn('font-medium', negative && 'text-destructive')}>{formatQty(currentStock)}</span>
          {hasCommitment && (
            <span className={cn('text-xs', freeStock < 0 ? 'text-destructive' : 'text-muted-foreground')}>
              ({formatQty(freeStock)} free)
            </span>
          )}
          {belowReorder && <AlertTriangleIcon className="size-3.5 text-amber-500" />}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1 text-xs">
          <p>
            <span className="text-muted-foreground">On hand</span> {formatQty(currentStock, unit)}
          </p>
          {hasCommitment && (
            <>
              <p>
                <span className="text-muted-foreground">Committed to open orders</span> {formatQty(committed, unit)}
              </p>
              <p>
                <span className="text-muted-foreground">Free</span> {formatQty(freeStock, unit)}
              </p>
            </>
          )}
          {reorderLevel > 0 && (
            <p>
              <span className="text-muted-foreground">Reorder at</span> {formatQty(reorderLevel, unit)}
            </p>
          )}
          {freeStock < 0 && (
            <p className="text-destructive">Open orders need more of this than exists.</p>
          )}
          {negative && <p className="text-destructive">Negative stock — a receipt was probably never logged.</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** A shortage figure, muted when there is nothing to chase. */
export function ShortageCell({ shortage, unit }: { shortage: number; unit: string }): React.JSX.Element {
  if (shortage <= 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1 font-medium tabular-nums text-destructive">
      {formatQty(shortage, unit)}
    </span>
  )
}

/**
 * Cartons, from the item's Quantity Packed. Shown as "3 boxes (2 + 2 loose)" so the
 * part-filled carton is explicit rather than hidden inside a ceiling.
 */
export function BoxCount({
  fullBoxes,
  loose,
  totalBoxes,
  unit
}: {
  fullBoxes: number
  loose: number
  totalBoxes: number | null
  unit: string
}): React.JSX.Element {
  if (totalBoxes == null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground">—</span>
        </TooltipTrigger>
        <TooltipContent>Set Quantity Packed on this item to get a carton count</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <PackageIcon className="size-3.5 text-muted-foreground" />
      <span className="font-medium tabular-nums">{totalBoxes}</span>
      {loose > 0 && (
        <span className="text-xs text-muted-foreground">
          ({fullBoxes} full + {formatQty(loose, unit)} loose)
        </span>
      )}
    </span>
  )
}
