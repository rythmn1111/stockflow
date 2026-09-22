import type { PackingBox } from '@shared/types'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'

interface BoxRow {
  id: string
  label: string
  length_mm: number | null
  width_mm: number | null
  height_mm: number | null
  empty_weight: number | null
  notes: string | null
  sort_index: number
  archived_at: number | null
  created_at: number
  updated_at: number
}

function toBox(r: BoxRow & { item_count?: number }): PackingBox {
  return {
    id: r.id,
    label: r.label,
    lengthMm: r.length_mm,
    widthMm: r.width_mm,
    heightMm: r.height_mm,
    emptyWeight: r.empty_weight,
    notes: r.notes,
    sortIndex: r.sort_index,
    archivedAt: r.archived_at,
    itemCount: r.item_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export interface BoxInput {
  label: string
  lengthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
  emptyWeight?: number | null
  notes?: string | null
}

/** Builds the display label from dimensions when the user has not written one. */
export function describeDimensions(input: {
  lengthMm?: number | null
  widthMm?: number | null
  heightMm?: number | null
}): string | null {
  const { lengthMm: l, widthMm: w, heightMm: h } = input
  if (l == null || w == null || h == null) return null
  return `${l}×${w}×${h} mm`
}

/**
 * The first of the app's editable lists: the box sizes an item can be packed in.
 *
 * Kept as a list so the same carton is one row with one name, rather than a phrase
 * retyped per item and spelled three different ways.
 */
export const packingBoxesRepo = {
  list(includeArchived = false): PackingBox[] {
    const where = includeArchived ? '' : 'WHERE b.archived_at IS NULL'
    return query<BoxRow & { item_count: number }>(
      `SELECT b.*, (SELECT COUNT(*) FROM items i WHERE i.packing_box_id = b.id) AS item_count
         FROM packing_boxes b
         ${where}
        ORDER BY b.sort_index ASC, b.label COLLATE NOCASE ASC`
    ).map(toBox)
  },

  get(id: string): PackingBox | null {
    const row = queryOne<BoxRow & { item_count: number }>(
      `SELECT b.*, (SELECT COUNT(*) FROM items i WHERE i.packing_box_id = b.id) AS item_count
         FROM packing_boxes b WHERE b.id = ?`,
      [id]
    )
    return row ? toBox(row) : null
  },

  byLabel(label: string): PackingBox | null {
    const row = queryOne<BoxRow & { item_count: number }>(
      `SELECT b.*, 0 AS item_count FROM packing_boxes b WHERE lower(b.label) = ?`,
      [label.trim().toLowerCase()]
    )
    return row ? toBox(row) : null
  },

  create(input: BoxInput): { ok: boolean; box: PackingBox | null; error?: string } {
    const label = input.label.trim() || describeDimensions(input) || ''
    if (!label) return { ok: false, box: null, error: 'Give the box a name, or its dimensions' }

    const existing = packingBoxesRepo.byLabel(label)
    if (existing) return { ok: false, box: existing, error: `"${label}" is already on the list` }

    const now = Date.now()
    const id = ids.packingBox()
    const maxSort = queryOne<{ m: number | null }>('SELECT MAX(sort_index) AS m FROM packing_boxes')?.m ?? 0
    run(
      `INSERT INTO packing_boxes (id, label, length_mm, width_mm, height_mm, empty_weight, notes, sort_index, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        label,
        input.lengthMm ?? null,
        input.widthMm ?? null,
        input.heightMm ?? null,
        input.emptyWeight ?? null,
        input.notes?.trim() || null,
        maxSort + 1,
        now,
        now
      ]
    )
    return { ok: true, box: packingBoxesRepo.get(id) }
  },

  update(id: string, patch: Partial<BoxInput> & { archived?: boolean }): { ok: boolean; error?: string } {
    const current = packingBoxesRepo.get(id)
    if (!current) return { ok: false, error: 'That box is not on the list' }

    const sets: string[] = []
    const params: unknown[] = []
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`)
      params.push(value)
    }

    if (patch.label !== undefined) {
      const label = patch.label.trim()
      if (!label) return { ok: false, error: 'A box needs a name' }
      const clash = packingBoxesRepo.byLabel(label)
      if (clash && clash.id !== id) return { ok: false, error: `"${label}" is already on the list` }
      push('label', label)
    }
    if (patch.lengthMm !== undefined) push('length_mm', patch.lengthMm)
    if (patch.widthMm !== undefined) push('width_mm', patch.widthMm)
    if (patch.heightMm !== undefined) push('height_mm', patch.heightMm)
    if (patch.emptyWeight !== undefined) push('empty_weight', patch.emptyWeight)
    if (patch.notes !== undefined) push('notes', patch.notes?.trim() || null)
    if (patch.archived !== undefined) push('archived_at', patch.archived ? Date.now() : null)
    if (!sets.length) return { ok: true }

    push('updated_at', Date.now())
    params.push(id)
    run(`UPDATE packing_boxes SET ${sets.join(', ')} WHERE id = ?`, params)
    return { ok: true }
  },

  reorder(orderedIds: string[]): PackingBox[] {
    return transaction(() => {
      orderedIds.forEach((id, index) =>
        run('UPDATE packing_boxes SET sort_index = ?, updated_at = ? WHERE id = ?', [index, Date.now(), id])
      )
      return packingBoxesRepo.list()
    })
  },

  /**
   * Refuses while items still point at the box — deleting it would blank their packing
   * details without saying so. Archiving hides it from the dropdown instead, which is
   * what someone retiring a carton size actually wants.
   */
  remove(id: string): { ok: boolean; error?: string } {
    const box = packingBoxesRepo.get(id)
    if (!box) return { ok: false, error: 'That box is not on the list' }
    if (box.itemCount > 0) {
      return {
        ok: false,
        error: `${box.itemCount} item${box.itemCount === 1 ? '' : 's'} use "${box.label}". Archive it instead — it will stop appearing for new items but stays on the ones that have it.`
      }
    }
    run('DELETE FROM packing_boxes WHERE id = ?', [id])
    return { ok: true }
  },

  /** Items packed in a given box, for the editables screen. */
  itemsIn(id: string): { id: string; code: string; name: string; quantityPacked: number | null }[] {
    return query<{ id: string; code: string; name: string; quantity_packed: number | null }>(
      `SELECT id, code, name, quantity_packed FROM items
        WHERE packing_box_id = ? AND archived_at IS NULL
        ORDER BY code COLLATE NOCASE ASC`,
      [id]
    ).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      quantityPacked: r.quantity_packed != null ? round(r.quantity_packed) : null
    }))
  }
}
