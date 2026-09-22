import type {
  ItemSupplierLink,
  ItemSupplierLinkWithItem,
  ItemSupplierLinkWithSupplier,
  ItemType
} from '@shared/types'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'

interface LinkRow {
  id: string
  item_id: string
  supplier_id: string
  is_preferred: number
  supplier_sku: string | null
  unit_price: number | null
  lead_time_days: number | null
  notes: string | null
  created_at: number
  updated_at: number
}

function toLink(r: LinkRow): ItemSupplierLink {
  return {
    id: r.id,
    itemId: r.item_id,
    supplierId: r.supplier_id,
    isPreferred: !!r.is_preferred,
    supplierSku: r.supplier_sku,
    unitPrice: r.unit_price,
    leadTimeDays: r.lead_time_days,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export interface LinkInput {
  supplierSku?: string | null
  unitPrice?: number | null
  leadTimeDays?: number | null
  notes?: string | null
  isPreferred?: boolean
}

/**
 * The many-to-many between parts and the suppliers who sell them.
 *
 * One invariant runs through every method here: **an item with at least one supplier
 * has exactly one preferred supplier.** The first link added becomes preferred
 * automatically, promoting another makes the previous one ordinary, and removing the
 * preferred one promotes whatever remains. Without that, Purchasing would have items
 * whose shortages belong to nobody.
 */
export const itemSuppliersRepo = {
  get(id: string): ItemSupplierLink | null {
    const row = queryOne<LinkRow>('SELECT * FROM item_suppliers WHERE id = ?', [id])
    return row ? toLink(row) : null
  },

  find(itemId: string, supplierId: string): ItemSupplierLink | null {
    const row = queryOne<LinkRow>('SELECT * FROM item_suppliers WHERE item_id = ? AND supplier_id = ?', [
      itemId,
      supplierId
    ])
    return row ? toLink(row) : null
  },

  /** Every supplier for one part, preferred first. */
  forItem(itemId: string): ItemSupplierLinkWithSupplier[] {
    return query<
      LinkRow & {
        supplier_name: string
        supplier_contact: string | null
        supplier_phone: string | null
        supplier_email: string | null
        supplier_lead_time: number | null
      }
    >(
      `SELECT isup.*,
              s.name AS supplier_name, s.contact AS supplier_contact, s.phone AS supplier_phone,
              s.email AS supplier_email, s.lead_time_days AS supplier_lead_time
         FROM item_suppliers isup
         JOIN suppliers s ON s.id = isup.supplier_id
        WHERE isup.item_id = ?
        ORDER BY isup.is_preferred DESC, s.name COLLATE NOCASE ASC`,
      [itemId]
    ).map((r) => ({
      ...toLink(r),
      supplierName: r.supplier_name,
      supplierContact: r.supplier_contact,
      supplierPhone: r.supplier_phone,
      supplierEmail: r.supplier_email,
      // A price negotiated for this part beats the supplier's general lead time.
      effectiveLeadTimeDays: r.lead_time_days ?? r.supplier_lead_time
    }))
  },

  /** Every part one supplier can provide, with its live stock position. */
  forSupplier(supplierId: string): ItemSupplierLinkWithItem[] {
    return query<
      LinkRow & {
        code: string
        name: string
        unit: string
        type: string
        reorder_level: number
        location: string | null
        rack: string | null
        current_stock: number | null
        committed: number | null
        opening_stock: number
        supplier_lead_time: number | null
      }
    >(
      `SELECT isup.*,
              i.code, i.name, i.unit, i.type, i.reorder_level, i.location, i.rack, i.opening_stock,
              st.current_stock, c.committed, s.lead_time_days AS supplier_lead_time
         FROM item_suppliers isup
         JOIN items i               ON i.id = isup.item_id
         JOIN suppliers s           ON s.id = isup.supplier_id
         LEFT JOIN item_stock st    ON st.item_id = i.id
         LEFT JOIN item_committed c ON c.item_id = i.id
        WHERE isup.supplier_id = ? AND i.archived_at IS NULL
        ORDER BY isup.is_preferred DESC, i.code COLLATE NOCASE ASC`,
      [supplierId]
    ).map((r) => {
      const currentStock = round(r.current_stock ?? r.opening_stock)
      const freeStock = round(currentStock - (r.committed ?? 0))
      return {
        ...toLink(r),
        code: r.code,
        name: r.name,
        unit: r.unit,
        type: r.type as ItemType,
        currentStock,
        freeStock,
        reorderLevel: r.reorder_level,
        belowReorder: r.reorder_level > 0 && freeStock <= r.reorder_level,
        location: r.location,
        rack: r.rack,
        isPreferredSource: !!r.is_preferred,
        effectiveLeadTimeDays: r.lead_time_days ?? r.supplier_lead_time
      }
    })
  },

  /** The preferred supplier id for a part, or null when it has no suppliers. */
  preferredFor(itemId: string): string | null {
    return (
      queryOne<{ supplier_id: string }>(
        'SELECT supplier_id FROM item_suppliers WHERE item_id = ? AND is_preferred = 1',
        [itemId]
      )?.supplier_id ?? null
    )
  },

  countFor(itemId: string): number {
    return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM item_suppliers WHERE item_id = ?', [itemId])?.c ?? 0
  },

  itemCountFor(supplierId: string): number {
    return (
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM item_suppliers WHERE supplier_id = ?', [supplierId])?.c ?? 0
    )
  },

  /**
   * Links a supplier to a part. Re-linking an existing pair updates it rather than
   * failing, so the item form can be saved repeatedly without complaint.
   */
  attach(itemId: string, supplierId: string, input: LinkInput = {}): { ok: boolean; error?: string } {
    const item = queryOne<{ id: string }>('SELECT id FROM items WHERE id = ?', [itemId])
    if (!item) return { ok: false, error: 'That item no longer exists' }
    const supplier = queryOne<{ id: string }>('SELECT id FROM suppliers WHERE id = ?', [supplierId])
    if (!supplier) return { ok: false, error: 'That supplier no longer exists' }

    return transaction(() => {
      const existing = itemSuppliersRepo.find(itemId, supplierId)
      if (existing) {
        itemSuppliersRepo.update(existing.id, input)
        return { ok: true }
      }

      // The first supplier for a part is preferred by definition — there is nothing to
      // compare it against, and leaving it unpreferred would orphan the part's shortages.
      const isFirst = itemSuppliersRepo.countFor(itemId) === 0
      const preferred = isFirst || input.isPreferred === true

      const now = Date.now()
      const id = ids.itemSupplier()
      if (preferred) run('UPDATE item_suppliers SET is_preferred = 0, updated_at = ? WHERE item_id = ?', [now, itemId])

      run(
        `INSERT INTO item_suppliers (id, item_id, supplier_id, is_preferred, supplier_sku, unit_price, lead_time_days, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          itemId,
          supplierId,
          preferred,
          input.supplierSku?.trim() || null,
          input.unitPrice ?? null,
          input.leadTimeDays ?? null,
          input.notes?.trim() || null,
          now,
          now
        ]
      )
      return { ok: true }
    })
  },

  update(id: string, input: LinkInput): { ok: boolean; error?: string } {
    const link = itemSuppliersRepo.get(id)
    if (!link) return { ok: false, error: 'That supplier link no longer exists' }

    return transaction(() => {
      const sets: string[] = []
      const params: unknown[] = []
      if (input.supplierSku !== undefined) {
        sets.push('supplier_sku = ?')
        params.push(input.supplierSku?.trim() || null)
      }
      if (input.unitPrice !== undefined) {
        sets.push('unit_price = ?')
        params.push(input.unitPrice)
      }
      if (input.leadTimeDays !== undefined) {
        sets.push('lead_time_days = ?')
        params.push(input.leadTimeDays)
      }
      if (input.notes !== undefined) {
        sets.push('notes = ?')
        params.push(input.notes?.trim() || null)
      }

      if (sets.length) {
        sets.push('updated_at = ?')
        params.push(Date.now(), id)
        run(`UPDATE item_suppliers SET ${sets.join(', ')} WHERE id = ?`, params)
      }

      // Promotion is separate: it has to demote the incumbent in the same transaction.
      if (input.isPreferred === true) itemSuppliersRepo.setPreferred(link.itemId, link.supplierId)
      return { ok: true }
    })
  },

  /** Makes one supplier the preferred source, demoting whichever held it. */
  setPreferred(itemId: string, supplierId: string): { ok: boolean; error?: string } {
    const link = itemSuppliersRepo.find(itemId, supplierId)
    if (!link) return { ok: false, error: 'That supplier is not linked to this item' }

    return transaction(() => {
      const now = Date.now()
      run('UPDATE item_suppliers SET is_preferred = 0, updated_at = ? WHERE item_id = ?', [now, itemId])
      run('UPDATE item_suppliers SET is_preferred = 1, updated_at = ? WHERE id = ?', [now, link.id])
      return { ok: true }
    })
  },

  /**
   * Unlinks a supplier from a part. If the preferred one is removed, the next remaining
   * supplier is promoted, so the invariant holds without the caller thinking about it.
   */
  detach(id: string): { ok: boolean; error?: string } {
    const link = itemSuppliersRepo.get(id)
    if (!link) return { ok: false, error: 'That supplier link no longer exists' }

    return transaction(() => {
      run('DELETE FROM item_suppliers WHERE id = ?', [id])
      if (link.isPreferred) {
        const next = queryOne<{ id: string }>(
          'SELECT id FROM item_suppliers WHERE item_id = ? ORDER BY created_at ASC LIMIT 1',
          [link.itemId]
        )
        if (next) run('UPDATE item_suppliers SET is_preferred = 1, updated_at = ? WHERE id = ?', [Date.now(), next.id])
      }
      return { ok: true }
    })
  },

  /** Replaces a part's whole supplier list in one transaction, used by the item form. */
  replaceFor(
    itemId: string,
    links: { supplierId: string; isPreferred?: boolean; supplierSku?: string | null; unitPrice?: number | null; leadTimeDays?: number | null }[]
  ): { ok: boolean; error?: string } {
    const seen = new Set<string>()
    for (const link of links) {
      if (seen.has(link.supplierId)) return { ok: false, error: 'The same supplier is listed twice' }
      seen.add(link.supplierId)
    }

    return transaction(() => {
      run('DELETE FROM item_suppliers WHERE item_id = ?', [itemId])
      // Whoever was flagged wins; failing that the first in the list leads, so the
      // invariant is satisfied even when the caller did not think about it.
      const preferredIndex = Math.max(links.findIndex((l) => l.isPreferred), 0)
      links.forEach((link, index) => {
        const result = itemSuppliersRepo.attach(itemId, link.supplierId, {
          ...link,
          isPreferred: index === preferredIndex
        })
        if (!result.ok) throw new Error(result.error ?? 'Could not link that supplier')
      })
      return { ok: true }
    })
  }
}
