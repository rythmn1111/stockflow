import type { Supplier, SupplierDetail } from '@shared/types'
import { query, queryOne, run } from './connection'
import { ids } from '../lib/ids'
import { itemSuppliersRepo } from './item-suppliers'
import { round } from '../lib/num'

interface SupplierRow {
  id: string
  name: string
  contact: string | null
  phone: string | null
  email: string | null
  address: string | null
  lead_time_days: number | null
  notes: string | null
  archived_at: number | null
  created_at: number
  updated_at: number
}

function toSupplier(r: SupplierRow): Supplier {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact,
    phone: r.phone,
    email: r.email,
    address: r.address,
    leadTimeDays: r.lead_time_days,
    notes: r.notes,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const suppliersRepo = {
  list(search?: string): Supplier[] {
    const term = search?.trim().toLowerCase()
    if (term) {
      return query<SupplierRow>(
        `SELECT * FROM suppliers
          WHERE lower(name) LIKE ? OR lower(coalesce(contact,'')) LIKE ? OR lower(coalesce(phone,'')) LIKE ?
          ORDER BY name COLLATE NOCASE ASC`,
        [`%${term}%`, `%${term}%`, `%${term}%`]
      ).map(toSupplier)
    }
    return query<SupplierRow>('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE ASC').map(toSupplier)
  },

  get(id: string): Supplier | null {
    const row = queryOne<SupplierRow>('SELECT * FROM suppliers WHERE id = ?', [id])
    return row ? toSupplier(row) : null
  },

  byName(name: string): Supplier | null {
    const row = queryOne<SupplierRow>('SELECT * FROM suppliers WHERE lower(name) = ?', [name.trim().toLowerCase()])
    return row ? toSupplier(row) : null
  },

  create(input: Partial<Supplier> & { name: string }): Supplier {
    const name = input.name.trim()
    if (!name) throw new Error('A supplier name is required')
    const existing = suppliersRepo.byName(name)
    if (existing) return existing

    const now = Date.now()
    const id = ids.supplier()
    run(
      `INSERT INTO suppliers (id, name, contact, phone, email, address, lead_time_days, notes, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        name,
        input.contact?.trim() || null,
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.address?.trim() || null,
        input.leadTimeDays ?? null,
        input.notes?.trim() || null,
        now,
        now
      ]
    )
    return suppliersRepo.get(id)!
  },

  /** Finds a supplier by name, creating it if new. Used heavily by the importer. */
  ensure(name: string, contact?: string | null): Supplier | null {
    const trimmed = name?.trim()
    if (!trimmed) return null
    const existing = suppliersRepo.byName(trimmed)
    if (existing) {
      // The workbook keeps contact alongside the name on every item row, so the first
      // non-empty value we see wins rather than the last one overwriting a good value.
      if (contact?.trim() && !existing.contact) {
        suppliersRepo.update(existing.id, { contact: contact.trim() })
        return suppliersRepo.get(existing.id)
      }
      return existing
    }
    return suppliersRepo.create({ name: trimmed, contact: contact?.trim() || null })
  },

  update(id: string, patch: Partial<Supplier>): Supplier | null {
    const current = suppliersRepo.get(id)
    if (!current) return null

    const sets: string[] = []
    const params: unknown[] = []
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      params.push(value)
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) throw new Error('A supplier name is required')
      const clash = suppliersRepo.byName(name)
      if (clash && clash.id !== id) throw new Error(`A supplier named "${name}" already exists`)
      push('name', name)
    }
    for (const key of ['contact', 'phone', 'email', 'address', 'notes'] as const) {
      if (patch[key] !== undefined) push(key, patch[key]?.toString().trim() || null)
    }
    if (patch.leadTimeDays !== undefined) push('lead_time_days', patch.leadTimeDays)
    if (patch.archivedAt !== undefined) push('archived_at', patch.archivedAt)
    if (!sets.length) return current

    push('updated_at', Date.now())
    params.push(id)
    run(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, params)
    return suppliersRepo.get(id)
  },

  itemCount(id: string): number {
    return itemSuppliersRepo.itemCountFor(id)
  },

  /**
   * The supplier card. The workbook repeated a supplier's name on every item row, so
   * "which parts does this supplier give us, and what are they holding up right now?"
   * required reading the whole sheet and doing it by eye.
   */
  detail(id: string): SupplierDetail | null {
    const supplier = suppliersRepo.get(id)
    if (!supplier) return null

    const parts = itemSuppliersRepo.forSupplier(id)

    // Shortages this supplier is the *preferred* source for — the ones that would
    // actually appear on their purchase order.
    const outstanding = query<{
      item_id: string
      code: string
      name: string
      unit: string
      shortage: number
      order_nos: string
      earliest_due: number | null
      link_lead: number | null
    }>(
      `SELECT pl.rm_item_id AS item_id, i.code, i.name, i.unit,
              SUM(pl.shortage)                AS shortage,
              group_concat(DISTINCT o.order_no) AS order_nos,
              MIN(o.due_date)                 AS earliest_due,
              MAX(isup.lead_time_days)        AS link_lead
         FROM plan_lines pl
         JOIN plans p     ON p.id = pl.plan_id AND p.superseded_at IS NULL
         JOIN orders o    ON o.id = p.order_id
         JOIN items i     ON i.id = pl.rm_item_id
         JOIN item_suppliers isup ON isup.item_id = i.id AND isup.supplier_id = ? AND isup.is_preferred = 1
        WHERE o.status IN ('draft','planned','in_production') AND pl.shortage > 0
        GROUP BY pl.rm_item_id
        ORDER BY SUM(pl.shortage) DESC`,
      [id]
    ).map((r) => {
      const lead = r.link_lead ?? supplier.leadTimeDays ?? 0
      return {
        itemId: r.item_id,
        code: r.code,
        name: r.name,
        unit: r.unit,
        shortage: round(r.shortage),
        orderNos: (r.order_nos ?? '').split(',').filter(Boolean),
        orderByDate: r.earliest_due != null ? r.earliest_due - lead * 86_400_000 : null
      }
    })

    // Only meaningful where a price is recorded, so a partial answer is not implied
    // to be the whole bill.
    const priced = outstanding.filter((line) => {
      const link = parts.find((p) => p.itemId === line.itemId)
      return link?.unitPrice != null
    })
    const outstandingValue = priced.length
      ? round(
          priced.reduce((sum, line) => {
            const link = parts.find((p) => p.itemId === line.itemId)!
            return sum + (link.unitPrice ?? 0) * line.shortage
          }, 0),
          2
        )
      : null

    const recentReceipts = query<{
      id: string
      moved_at: number
      code: string
      name: string
      qty: number
      unit: string
      reference_no: string | null
    }>(
      `SELECT m.id, m.moved_at, i.code, i.name, m.qty, i.unit, m.reference_no
         FROM stock_moves m
         JOIN items i             ON i.id = m.item_id
         JOIN item_suppliers isup ON isup.item_id = i.id AND isup.supplier_id = ?
        WHERE m.direction = 'in' AND m.reason = 'purchase' AND m.voided_at IS NULL
        ORDER BY m.moved_at DESC
        LIMIT 15`,
      [id]
    ).map((r) => ({
      id: r.id,
      movedAt: r.moved_at,
      code: r.code,
      name: r.name,
      qty: round(r.qty),
      unit: r.unit,
      referenceNo: r.reference_no
    }))

    return {
      supplier,
      parts,
      preferredCount: parts.filter((p) => p.isPreferredSource).length,
      belowReorderCount: parts.filter((p) => p.belowReorder).length,
      outstanding,
      outstandingValue,
      recentReceipts
    }
  },

  /**
   * Deleting a supplier nulls the reference on its items rather than taking them with
   * it — losing the part master because a vendor changed would be indefensible. The
   * foreign key does this via ON DELETE SET NULL; the count is returned so the UI can
   * say what happened.
   */
  remove(id: string): { ok: boolean; error?: string } {
    if (!suppliersRepo.get(id)) return { ok: false, error: 'Supplier not found' }
    run('DELETE FROM suppliers WHERE id = ?', [id])
    return { ok: true }
  }
}
