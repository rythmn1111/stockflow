import { useState } from 'react'
import { BoxesIcon, PencilIcon, PhoneIcon, PlusIcon, SearchIcon, TrashIcon, TruckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { qk } from '@/lib/query-keys'
import { pluralise } from '@/lib/format'
import { SupplierDetailSheet } from '@/features/supplier-detail-sheet'
import { useAppMutation, useSuppliers } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'
import { useNavigate } from 'react-router-dom'

/**
 * Suppliers, normalised out of the two columns the workbook repeated on every item row.
 * Their lead time is what lets the purchase list say *when* to order, not just what.
 */
export function SuppliersPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data: suppliers, isLoading } = useSuppliers(search || undefined)
  const { openSupplierForm, setItemFilters } = useUiStore()
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [openSupplierId, setOpenSupplierId] = useState<string | null>(null)

  const remove = useAppMutation((id: string) => window.api.suppliers.remove(id), {
    invalidate: [qk.suppliersRoot, qk.itemsRoot, qk.purchasing],
    successMessage: 'Supplier deleted',
    onSuccess: () => setConfirmDelete(null)
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, contact, phone…"
            className="h-8 pl-8"
          />
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => openSupplierForm()}>
          <PlusIcon className="size-3.5" />
          New supplier
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !suppliers?.length ? (
          <EmptyState
            icon={TruckIcon}
            title={search ? 'No suppliers match' : 'No suppliers yet'}
            description="Recording who sells each part is what turns a list of shortages into a list of phone calls."
            action={<Button onClick={() => openSupplierForm()}>Add a supplier</Button>}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="w-32">Phone</TableHead>
                <TableHead className="w-40">Email</TableHead>
                <TableHead className="w-24 text-right">Lead time</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow
                  key={supplier.id}
                  className="cursor-pointer"
                  onClick={() => setOpenSupplierId(supplier.id)}
                >
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                    {supplier.contact ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {supplier.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <PhoneIcon className="size-3" />
                        {supplier.phone}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
                    {supplier.email ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {supplier.leadTimeDays != null ? pluralise(supplier.leadTimeDays, 'day') : '—'}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => {
                              setItemFilters({ supplierIds: [supplier.id], stockFilter: 'all' })
                              navigate('/items')
                            }}
                          >
                            <BoxesIcon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Show their parts in the item list</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => openSupplierForm(supplier.id)}
                          >
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
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmDelete({ id: supplier.id, name: supplier.name })}
                          >
                            <TrashIcon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <SupplierDetailSheet supplierId={openSupplierId} onClose={() => setOpenSupplierId(null)} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Items sourced from this supplier keep their part data and simply lose the supplier link — nothing in the
              item master or the ledger is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                if (confirmDelete) remove.mutate(confirmDelete.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
