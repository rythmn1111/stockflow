import type { BomLine, BomLineWithItems, ItemType } from '@shared/types'
import { query, queryOne, run, transaction } from './connection'
import { ids } from '../lib/ids'
import { round } from '../lib/num'

interface BomRow {
  id: string
  fg_item_id: string
  rm_item_id: string
  qty_per_unit: number
  scrap_percent: number
  notes: string | null
  created_at: number
  updated_at: number
}

type JoinRow = BomRow & {
  fg_code: string
  fg_name: string
  rm_code: string
  rm_name: string
  rm_unit: string
  rm_type: string
  supplier_name: string | null
}

function toLine(r: BomRow): BomLine {
  return {
    id: r.id,
    fgItemId: r.fg_item_id,
    rmItemId: r.rm_item_id,
    qtyPerUnit: r.qty_per_unit,
    scrapPercent: r.scrap_percent,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function toLineWithItems(r: JoinRow): BomLineWithItems {
  return {
    ...toLine(r),
    fgCode: r.fg_code,
    fgName: r.fg_name,
    rmCode: r.rm_code,
    rmName: r.rm_name,
    rmUnit: r.rm_unit,
    rmType: r.rm_type as ItemType,
    supplierName: r.supplier_name
  }
}

const JOIN_SQL = `
  SELECT b.*,
         fg.code AS fg_code, fg.name AS fg_name,
         rm.code AS rm_code, rm.name AS rm_name, rm.unit AS rm_unit, rm.type AS rm_type,
         s.name  AS supplier_name
    FROM bom_lines b
    JOIN items fg         ON fg.id = b.fg_item_id
    JOIN items rm         ON rm.id = b.rm_item_id
    LEFT JOIN item_suppliers rmsup ON rmsup.item_id = rm.id AND rmsup.is_preferred = 1
    LEFT JOIN suppliers s          ON s.id = rmsup.supplier_id`

export interface ExplodedLine {
  itemId: string
  code: string
  name: string
  unit: string
  qty: number
  /** 1 = direct child of the finished good, 2 = child of a sub-assembly, and so on. */
  depth: number
}

/** Guard against a bill of materials that is deep by mistake rather than by design. */
const MAX_DEPTH = 12

export const bomRepo = {
  list(fgItemId?: string): BomLineWithItems[] {
    if (fgItemId) {
      return query<JoinRow>(`${JOIN_SQL} WHERE b.fg_item_id = ? ORDER BY rm.code COLLATE NOCASE ASC`, [
        fgItemId
      ]).map(toLineWithItems)
    }
    return query<JoinRow>(
      `${JOIN_SQL} ORDER BY fg.code COLLATE NOCASE ASC, rm.code COLLATE NOCASE ASC`
    ).map(toLineWithItems)
  },

  get(id: string): BomLine | null {
    const row = queryOne<BomRow>('SELECT * FROM bom_lines WHERE id = ?', [id])
    return row ? toLine(row) : null
  },

  /** Lines where this item is the component — what it feeds into. */
  usedIn(itemId: string): BomLineWithItems[] {
    return query<JoinRow>(`${JOIN_SQL} WHERE b.rm_item_id = ? ORDER BY fg.code COLLATE NOCASE ASC`, [itemId]).map(
      toLineWithItems
    )
  },

  /**
   * Walks the tree from `fgItemId` looking for a path back to it. A bill of materials
   * that contains itself would make explosion loop forever, and the workbook had no
   * check at all because it only ever read one level.
   *
   * Returns the offending path as item codes, or null when the addition is safe.
   */
  findCycle(fgItemId: string, candidateChildId: string): string[] | null {
    if (fgItemId === candidateChildId) {
      const code = queryOne<{ code: string }>('SELECT code FROM items WHERE id = ?', [fgItemId])?.code ?? '?'
      return [code, code]
    }

    // Depth-first from the candidate child: if we can reach the parent, adding this
    // line closes a loop.
    const stack: { id: string; path: string[] }[] = [{ id: candidateChildId, path: [candidateChildId] }]
    const seen = new Set<string>()

    while (stack.length) {
      const { id, path } = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)

      const children = query<{ rm_item_id: string }>('SELECT rm_item_id FROM bom_lines WHERE fg_item_id = ?', [id])
      for (const child of children) {
        if (child.rm_item_id === fgItemId) {
          const codes = bomRepo.codesFor([...path, fgItemId])
          return codes
        }
        if (!seen.has(child.rm_item_id)) stack.push({ id: child.rm_item_id, path: [...path, child.rm_item_id] })
      }
    }
    return null
  },

  codesFor(itemIds: string[]): string[] {
    if (!itemIds.length) return []
    const rows = query<{ id: string; code: string }>(
      `SELECT id, code FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    )
    const map = new Map(rows.map((r) => [r.id, r.code]))
    return itemIds.map((id) => map.get(id) ?? '?')
  },

  addLine(input: {
    fgItemId: string
    rmItemId: string
    qtyPerUnit: number
    scrapPercent?: number
    notes?: string | null
  }): { ok: boolean; error?: string } {
    if (input.fgItemId === input.rmItemId) return { ok: false, error: 'An item cannot be a component of itself' }
    if (!(input.qtyPerUnit > 0)) return { ok: false, error: 'Quantity per unit must be greater than zero' }

    const cycle = bomRepo.findCycle(input.fgItemId, input.rmItemId)
    if (cycle) {
      return { ok: false, error: `That would create a loop in the bill of materials: ${cycle.join(' → ')}` }
    }

    const existing = queryOne<{ id: string }>(
      'SELECT id FROM bom_lines WHERE fg_item_id = ? AND rm_item_id = ?',
      [input.fgItemId, input.rmItemId]
    )
    if (existing) {
      return { ok: false, error: 'That component is already on this bill of materials — edit the quantity instead' }
    }

    const now = Date.now()
    run(
      `INSERT INTO bom_lines (id, fg_item_id, rm_item_id, qty_per_unit, scrap_percent, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ids.bomLine(),
        input.fgItemId,
        input.rmItemId,
        round(input.qtyPerUnit),
        round(input.scrapPercent ?? 0, 2),
        input.notes?.trim() || null,
        now,
        now
      ]
    )
    return { ok: true }
  },

  updateLine(
    id: string,
    patch: { qtyPerUnit?: number; scrapPercent?: number; notes?: string | null }
  ): { ok: boolean; error?: string } {
    if (!bomRepo.get(id)) return { ok: false, error: 'Bill-of-materials line not found' }
    if (patch.qtyPerUnit !== undefined && !(patch.qtyPerUnit > 0)) {
      return { ok: false, error: 'Quantity per unit must be greater than zero' }
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (patch.qtyPerUnit !== undefined) {
      sets.push('qty_per_unit = ?')
      params.push(round(patch.qtyPerUnit))
    }
    if (patch.scrapPercent !== undefined) {
      sets.push('scrap_percent = ?')
      params.push(round(patch.scrapPercent, 2))
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?')
      params.push(patch.notes?.trim() || null)
    }
    if (!sets.length) return { ok: true }

    sets.push('updated_at = ?')
    params.push(Date.now(), id)
    run(`UPDATE bom_lines SET ${sets.join(', ')} WHERE id = ?`, params)
    return { ok: true }
  },

  removeLine(id: string): boolean {
    return run('DELETE FROM bom_lines WHERE id = ?', [id]).changes > 0
  },

  /** Replaces a finished good's whole component list atomically. */
  replaceFor(
    fgItemId: string,
    lines: { rmItemId: string; qtyPerUnit: number; scrapPercent?: number }[]
  ): { ok: boolean; error?: string } {
    const seen = new Set<string>()
    for (const line of lines) {
      if (line.rmItemId === fgItemId) return { ok: false, error: 'An item cannot be a component of itself' }
      if (!(line.qtyPerUnit > 0)) return { ok: false, error: 'Every component needs a quantity greater than zero' }
      if (seen.has(line.rmItemId)) return { ok: false, error: 'The same component is listed twice' }
      seen.add(line.rmItemId)
    }

    return transaction(() => {
      run('DELETE FROM bom_lines WHERE fg_item_id = ?', [fgItemId])
      const now = Date.now()
      for (const line of lines) {
        // Checked inside the transaction, after the old lines are gone, so replacing a
        // list that already contained a benign self-reference still validates cleanly.
        const cycle = bomRepo.findCycle(fgItemId, line.rmItemId)
        if (cycle) throw new Error(`That would create a loop in the bill of materials: ${cycle.join(' → ')}`)
        run(
          `INSERT INTO bom_lines (id, fg_item_id, rm_item_id, qty_per_unit, scrap_percent, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
          [ids.bomLine(), fgItemId, line.rmItemId, round(line.qtyPerUnit), round(line.scrapPercent ?? 0, 2), now, now]
        )
      }
      return { ok: true }
    })
  },

  /** Clones one finished good's components onto another — most variants differ slightly. */
  copyFrom(sourceFgItemId: string, targetFgItemId: string): { ok: boolean; copied: number; error?: string } {
    if (sourceFgItemId === targetFgItemId) return { ok: false, copied: 0, error: 'Source and target are the same item' }
    const source = bomRepo.list(sourceFgItemId)
    if (!source.length) return { ok: false, copied: 0, error: 'That item has no components to copy' }

    return transaction(() => {
      let copied = 0
      for (const line of source) {
        const result = bomRepo.addLine({
          fgItemId: targetFgItemId,
          rmItemId: line.rmItemId,
          qtyPerUnit: line.qtyPerUnit,
          scrapPercent: line.scrapPercent,
          notes: line.notes
        })
        if (result.ok) copied++
      }
      return { ok: copied > 0, copied, error: copied ? undefined : 'Nothing could be copied' }
    })
  },

  /**
   * Recursive requirement explosion. The workbook multiplied one level of BOM by the
   * order quantity; this walks sub-assemblies too, applies each line's scrap
   * allowance, and sums components that appear on more than one branch.
   *
   * Only leaves are returned as requirements — an item with its own components is a
   * sub-assembly to be built, not a part to be bought.
   */
  explode(fgItemId: string, qty: number): { lines: ExplodedLine[]; cycle: string[] | null } {
    if (!(qty > 0)) return { lines: [], cycle: null }

    const totals = new Map<string, { qty: number; depth: number }>()
    const visiting = new Set<string>()
    let cycle: string[] | null = null

    const walk = (parentId: string, multiplier: number, depth: number, path: string[]): void => {
      if (cycle || depth > MAX_DEPTH) return
      if (visiting.has(parentId)) {
        cycle = bomRepo.codesFor([...path, parentId])
        return
      }
      visiting.add(parentId)

      const children = query<{ rm_item_id: string; qty_per_unit: number; scrap_percent: number }>(
        'SELECT rm_item_id, qty_per_unit, scrap_percent FROM bom_lines WHERE fg_item_id = ?',
        [parentId]
      )

      for (const child of children) {
        // Scrap inflates the requirement: 100 units at 5% scrap needs 105 issued.
        const need = multiplier * child.qty_per_unit * (1 + (child.scrap_percent || 0) / 100)
        const hasOwnChildren =
          (queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM bom_lines WHERE fg_item_id = ?', [child.rm_item_id])
            ?.c ?? 0) > 0

        if (hasOwnChildren) {
          walk(child.rm_item_id, need, depth + 1, [...path, parentId])
        } else {
          const existing = totals.get(child.rm_item_id)
          totals.set(child.rm_item_id, {
            qty: (existing?.qty ?? 0) + need,
            // Keep the shallowest depth a component was reached at, so the plan reads
            // in the order someone would actually build it.
            depth: existing ? Math.min(existing.depth, depth) : depth
          })
        }
      }

      visiting.delete(parentId)
    }

    walk(fgItemId, qty, 1, [])
    if (cycle) return { lines: [], cycle }
    if (!totals.size) return { lines: [], cycle: null }

    const itemIds = [...totals.keys()]
    const rows = query<{ id: string; code: string; name: string; unit: string }>(
      `SELECT id, code, name, unit FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`,
      itemIds
    )
    const meta = new Map(rows.map((r) => [r.id, r]))

    const lines = itemIds
      .map((id) => {
        const info = meta.get(id)
        const total = totals.get(id)!
        return {
          itemId: id,
          code: info?.code ?? '?',
          name: info?.name ?? 'Unknown item',
          unit: info?.unit ?? '',
          qty: round(total.qty),
          depth: total.depth
        }
      })
      .sort((a, b) => a.depth - b.depth || a.code.localeCompare(b.code, undefined, { numeric: true }))

    return { lines, cycle: null }
  },

  /** Finished goods that have at least one component, for pickers. */
  fgWithBom(): { id: string; code: string; name: string; lineCount: number }[] {
    return query<{ id: string; code: string; name: string; c: number }>(
      `SELECT i.id, i.code, i.name, COUNT(b.id) AS c
         FROM items i
         JOIN bom_lines b ON b.fg_item_id = i.id
        WHERE i.archived_at IS NULL
        GROUP BY i.id
        ORDER BY i.code COLLATE NOCASE ASC`
    ).map((r) => ({ id: r.id, code: r.code, name: r.name, lineCount: r.c }))
  },

  count(): number {
    return queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM bom_lines')?.c ?? 0
  }
}
