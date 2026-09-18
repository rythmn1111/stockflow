import { useState } from 'react'
import { AlertTriangleIcon, MapPinIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { qk } from '@/lib/query-keys'
import { formatQty, formatWeight, pluralise } from '@/lib/format'
import { useAppMutation, useLocationSummaries } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * Stock by shelf. The workbook had a Location column that nothing ever grouped on, so
 * it could not answer "what is on shelf B-2" — the question you need answered when
 * stock-taking, and the one that makes a pick list walkable.
 */
export function LocationsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { data: locations, isLoading } = useLocationSummaries()
  const { setItemFilters } = useUiStore()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const rename = useAppMutation(({ from, to }: { from: string; to: string }) => window.api.locations.rename(from, to), {
    invalidate: [qk.itemsRoot, qk.locationSummaries, qk.itemLocations],
    successMessage: (result) => `Moved ${pluralise(result.affected, 'item')}`,
    onSuccess: (result) => {
      if (result.ok) {
        setRenaming(null)
        setNewName('')
      }
    }
  })

  if (isLoading) {
    return (
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }

  if (!locations?.length) {
    return (
      <div className="p-5">
        <EmptyState
          icon={MapPinIcon}
          title="No locations set"
          description="Give items a Location — a shelf, bin or rack — and pick lists will group by it so the store is walked once instead of criss-crossed."
          action={<Button onClick={() => navigate('/items')}>Go to items</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-5">
      <p className="text-xs text-muted-foreground">
        {pluralise(locations.length, 'location')} · click one to filter the item list
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((location) => (
          <Card
            key={location.location}
            className={cn(
              'group cursor-pointer transition-colors hover:border-foreground/20',
              location.belowReorderCount > 0 && 'border-amber-500/30'
            )}
            onClick={() => {
              setItemFilters({ locations: [location.location], stockFilter: 'all' })
              navigate('/items')
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <MapPinIcon className="size-3.5 text-muted-foreground" />
                  {location.location}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(location.location)
                    setNewName(location.location)
                  }}
                >
                  <PencilIcon className="size-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span className="tabular-nums">{location.itemCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Units on hand</span>
                  <span className="tabular-nums">{formatQty(location.totalUnits)}</span>
                </div>
                {location.totalNetWeight != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Net weight</span>
                    <span className="tabular-nums">{formatWeight(location.totalNetWeight)}</span>
                  </div>
                )}
              </div>

              {location.belowReorderCount > 0 && (
                <Badge variant="warning" className="mt-2 h-5 gap-1 px-1.5 text-[10px]">
                  <AlertTriangleIcon className="size-3" />
                  {location.belowReorderCount} below reorder
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename {renaming}</DialogTitle>
            <DialogDescription>
              Every item at this location moves to the new name. Useful for a shelf reshuffle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="newLocation">New location</Label>
            <Input id="newLocation" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!newName.trim() || newName === renaming || rename.isPending}
              onClick={() => renaming && rename.mutate({ from: renaming, to: newName })}
            >
              Move items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
