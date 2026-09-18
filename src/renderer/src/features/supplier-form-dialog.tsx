import { useEffect, useState } from 'react'
import type { Supplier } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { qk } from '@/lib/query-keys'
import { useAppMutation, useSuppliers } from '@/hooks/use-data'
import { useUiStore } from '@/store/ui'

/**
 * Suppliers were two columns repeated on every Item_Master row. As their own record a
 * phone number is corrected once, and `lead time` becomes usable: the purchase list can
 * work backwards from an order's due date to say when to place the order.
 */
export function SupplierFormDialog(): React.JSX.Element {
  const { supplierFormOpen, supplierFormId, closeSupplierForm } = useUiStore()
  const { data: suppliers } = useSuppliers()
  const existing = suppliers?.find((s) => s.id === supplierFormId)

  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [leadTimeDays, setLeadTimeDays] = useState('')
  const [notes, setNotes] = useState('')

  const editing = !!supplierFormId

  useEffect(() => {
    if (!supplierFormOpen) return
    setName(existing?.name ?? '')
    setContact(existing?.contact ?? '')
    setPhone(existing?.phone ?? '')
    setEmail(existing?.email ?? '')
    setAddress(existing?.address ?? '')
    setLeadTimeDays(existing?.leadTimeDays != null ? String(existing.leadTimeDays) : '')
    setNotes(existing?.notes ?? '')
  }, [supplierFormOpen, existing])

  const payload = (): Partial<Supplier> & { name: string } => {
    const days = Number(leadTimeDays)
    return {
      name: name.trim(),
      contact: contact.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      leadTimeDays: leadTimeDays.trim() && Number.isFinite(days) ? days : null,
      notes: notes.trim() || null
    }
  }

  const create = useAppMutation((input: Partial<Supplier> & { name: string }) => window.api.suppliers.create(input), {
    invalidate: [qk.suppliersRoot, qk.stats],
    successMessage: (supplier) => `${supplier.name} added`,
    onSuccess: () => closeSupplierForm()
  })

  const update = useAppMutation(
    ({ id, input }: { id: string; input: Partial<Supplier> }) => window.api.suppliers.update(id, input),
    {
      invalidate: [qk.suppliersRoot, qk.itemsRoot, qk.purchasing, qk.plansRoot],
      successMessage: 'Supplier saved',
      onSuccess: () => closeSupplierForm()
    }
  )

  const submit = (): void => {
    if (!name.trim()) return
    if (editing && supplierFormId) update.mutate({ id: supplierFormId, input: payload() })
    else create.mutate(payload())
  }

  const busy = create.isPending || update.isPending

  return (
    <Dialog open={supplierFormOpen} onOpenChange={(open) => !open && closeSupplierForm()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${existing?.name ?? 'supplier'}` : 'New supplier'}</DialogTitle>
          <DialogDescription>Who you buy from, and how long they take.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sname">Name</Label>
            <Input id="sname" value={name} onChange={(e) => setName(e.target.value)} placeholder="S-1" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="scontact">Contact details</Label>
              <Input id="scontact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Person or number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sphone">Phone</Label>
              <Input id="sphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semail">Email</Label>
              <Input id="semail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slead">Lead time (days)</Label>
              <Input
                id="slead"
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value)}
                placeholder="7"
                inputMode="numeric"
              />
              <p className="text-[11px] text-muted-foreground">Used to work out when to place an order.</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="saddress">Address</Label>
            <Textarea id="saddress" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="snotes">Notes</Label>
            <Textarea id="snotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={closeSupplierForm} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {editing ? 'Save changes' : 'Add supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
