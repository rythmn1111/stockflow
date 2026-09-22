import type { ItemPhotoMeta } from '@shared/types'
import { queryOne, run } from './connection'

/**
 * Item photos, stored in the database rather than as loose files on disk.
 *
 * The deciding factor is backup: a snapshot is `VACUUM INTO` of the database, so
 * photos kept alongside it would silently fall out of sync on restore — you would
 * recover a register whose pictures belong to a different day. Keeping the bytes in
 * SQLite makes a snapshot complete by construction.
 *
 * The cost is size, which is contained two ways: the renderer downscales every image
 * with a canvas before it gets here (so nothing stores a 12 MP phone photo), and the
 * bytes live in their own table so `SELECT i.*` on the items list can never drag them
 * along by accident.
 */
export const photosRepo = {
  /** Metadata only — safe to call for a list. */
  meta(itemId: string): ItemPhotoMeta | null {
    const row = queryOne<{
      item_id: string
      mime: string
      width: number | null
      height: number | null
      bytes: number
      created_at: number
    }>('SELECT item_id, mime, width, height, bytes, created_at FROM item_photos WHERE item_id = ?', [itemId])
    if (!row) return null
    return {
      itemId: row.item_id,
      mime: row.mime,
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      createdAt: row.created_at
    }
  },

  /** The display copy, as a data URL the renderer can put straight in an `img`. */
  full(itemId: string): string | null {
    const row = queryOne<{ mime: string; full: Uint8Array }>('SELECT mime, full FROM item_photos WHERE item_id = ?', [
      itemId
    ])
    if (!row?.full) return null
    return `data:${row.mime};base64,${Buffer.from(row.full).toString('base64')}`
  },

  thumb(itemId: string): string | null {
    const row = queryOne<{ mime: string; thumb: Uint8Array }>(
      'SELECT mime, thumb FROM item_photos WHERE item_id = ?',
      [itemId]
    )
    if (!row?.thumb) return null
    return `data:${row.mime};base64,${Buffer.from(row.thumb).toString('base64')}`
  },

  /** One photo per item, so saving a new one replaces whatever was there. */
  set(input: {
    itemId: string
    mime: string
    thumb: Uint8Array
    full: Uint8Array
    width?: number | null
    height?: number | null
  }): { ok: boolean; error?: string } {
    const item = queryOne<{ id: string }>('SELECT id FROM items WHERE id = ?', [input.itemId])
    if (!item) return { ok: false, error: 'That item no longer exists' }
    if (!input.full?.length || !input.thumb?.length) return { ok: false, error: 'That image could not be read' }

    run(
      `INSERT INTO item_photos (item_id, mime, thumb, full, width, height, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         mime = excluded.mime, thumb = excluded.thumb, full = excluded.full,
         width = excluded.width, height = excluded.height, bytes = excluded.bytes,
         created_at = excluded.created_at`,
      [
        input.itemId,
        input.mime,
        input.thumb,
        input.full,
        input.width ?? null,
        input.height ?? null,
        input.full.length,
        Date.now()
      ]
    )
    return { ok: true }
  },

  remove(itemId: string): boolean {
    return run('DELETE FROM item_photos WHERE item_id = ?', [itemId]).changes > 0
  },

  /** Total space photos occupy, shown in Settings so it never becomes a surprise. */
  totals(): { count: number; bytes: number } {
    const row = queryOne<{ c: number; b: number | null }>(
      'SELECT COUNT(*) AS c, SUM(bytes) AS b FROM item_photos'
    )
    return { count: row?.c ?? 0, bytes: row?.b ?? 0 }
  }
}
