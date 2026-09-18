import { useState } from 'react'
import { ArrowDownUpIcon, BanIcon, DownloadIcon, ScrollTextIcon, SearchIcon } from 'lucide-react'
import type { MoveDirection } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { DirectionIcon, ItemCode } from '@/components/stock-bits'
import { qk } from '@/lib/query-keys'
import { formatDate, formatQty, MOVE_REASON_LABELS, pluralise } from '@/lib/format'
import { useAppMutation, useMoves } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { cn } from '@/lib/utils'

/**
 * The Material_Log sheet — the ledger everything else is derived from.
 *
 * The one rule that makes it a register rather than a list: entries are never edited or
 * deleted, only voided with a reason. A voided row stays visible, struck through, and
 * stops counting toward stock.
 */
export function LedgerPage(): React.JSX.Element {
  const { moveFilters, setMoveFilters, openMoveForm } = useUiStore()
  const { data, isLoading, isPlaceholderData } = useMoves(moveFilters)
  const [voidTarget, setVoidTarget] = useState<{ id: string; label: string } | null>(null)
  const [voidReason, setVoidReason] = useState('')

  const voidMove = useAppMutation(
    ({ id, reason }: { id: string; reason: string }) => window.api.moves.void(id, reason),
    {
      invalidate: [qk.movesRoot, qk.itemsRoot, qk.ordersRoot, qk.plansRoot, qk.purchasing, qk.stats],
      successMessage: 'Entry voided',
      onSuccess: (result) => {
        if (result.ok) {
          setVoidTarget(null)
          setVoidReason('')
        }
      }
    }
  )

  const moves = data?.items ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={moveFilters.search ?? ''}
            onChange={(e) => setMoveFilters({ search: e.target.value })}
            placeholder="Search item, reference, order, remarks…"
            className="h-8 pl-8"
          />
        </div>

        <Select
          value={moveFilters.direction ?? 'all'}
          onValueChange={(value) => setMoveFilters({ direction: value as MoveDirection | 'all' })}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both ways</SelectItem>
            <SelectItem value="in">Inward only</SelectItem>
            <SelectItem value="out">Outward only</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={moveFilters.reasons?.[0] ?? 'all'}
          onValueChange={(value) => setMoveFilters({ reasons: value === 'all' ? [] : [value as never] })}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Any reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any reason</SelectItem>
            {Object.entries(MOVE_REASON_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 pl-1">
          <Switch
            id="voided"
            checked={!!moveFilters.includeVoided}
            onCheckedChange={(checked) => setMoveFilters({ includeVoided: checked })}
          />
          <Label htmlFor="voided" className="text-xs text-muted-foreground">
            Show voided
          </Label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void window.api.moves.exportCsv(moveFilters)}
          >
            <DownloadIcon className="size-3.5" />
            Export
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => openMoveForm()}>
            <ArrowDownUpIcon className="size-3.5" />
            Record movement
          </Button>
        </div>
      </div>

      <div className="px-4 py-1.5 text-xs text-muted-foreground">
        {data ? pluralise(data.total, 'entry', 'entries') : '…'}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : moves.length === 0 ? (
          <EmptyState
            icon={ScrollTextIcon}
            title={moveFilters.search ? 'Nothing matches' : 'The ledger is empty'}
            description="Every receipt, issue and adjustment lands here. Stock is calculated from these entries, never typed in directly."
            action={<Button onClick={() => openMoveForm()}>Record the first movement</Button>}
          />
        ) : (
          <Table className={cn(isPlaceholderData && 'opacity-60')}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Date</TableHead>
                <TableHead className="w-8" />
                <TableHead className="w-24">Item</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                <TableHead className="w-36">Reason</TableHead>
                <TableHead className="w-24">Reference</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {moves.map((move) => (
                <TableRow key={move.id} className={cn(move.voidedAt && 'opacity-50')}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(move.movedAt)}</TableCell>
                  <TableCell>
                    <DirectionIcon direction={move.direction} />
                  </TableCell>
                  <TableCell>
                    <ItemCode code={move.itemCode} />
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{move.itemName}</TableCell>
                  <TableCell
                    className={cn('text-right font-medium tabular-nums', move.voidedAt && 'line-through')}
                  >
                    {formatQty(move.qty, move.itemUnit)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {MOVE_REASON_LABELS[move.reason] ?? move.reason}
                  </TableCell>
                  <TableCell className="text-xs">
                    {move.orderNo ? (
                      <Badge variant="muted" className="h-4 px-1 font-mono text-[10px]">
                        {move.orderNo}
                      </Badge>
                    ) : move.referenceNo ? (
                      <span className="text-muted-foreground">{move.referenceNo}</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {move.voidedAt ? (
                      <span className="text-destructive">Voided: {move.voidedReason}</span>
                    ) : (
                      (move.remarks ?? '—')
                    )}
                  </TableCell>
                  <TableCell>
                    {!move.voidedAt && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setVoidTarget({
                                id: move.id,
                                label: `${move.direction === 'in' ? 'Inward' : 'Outward'} ${formatQty(move.qty, move.itemUnit)} of ${move.itemCode}`
                              })
                            }
                          >
                            <BanIcon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Void this entry</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AlertDialog open={!!voidTarget} onOpenChange={(open) => !open && setVoidTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget?.label}. The entry stays in the ledger, struck through, and stops counting toward stock —
              that is what keeps the register auditable. A reason is required.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="voidReason">Reason</Label>
            <Input
              id="voidReason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Entered twice by mistake"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setVoidReason('')}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!voidReason.trim() || voidMove.isPending}
              onClick={() => voidTarget && voidMove.mutate({ id: voidTarget.id, reason: voidReason })}
            >
              Void entry
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
