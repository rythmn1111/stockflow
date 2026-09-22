import type { DashboardStats } from '@shared/types'
import { ITEM_TYPES } from '@shared/types'
import { queryOne } from './connection'
import { itemsRepo } from './items'
import { movesRepo } from './moves'
import { ordersRepo } from './orders'
import { plansRepo } from './plans'
import { suppliersRepo } from './suppliers'

const DAY = 86_400_000

export const statsRepo = {
  dashboard(): DashboardStats {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()

    const count = (sql: string, params: unknown[] = []): number =>
      queryOne<{ c: number }>(sql, params)?.c ?? 0

    // Reorder alerts run on free stock, not on hand: a part fully promised to an open
    // order is not available to the next one, whatever the shelf says.
    const free = 'COALESCE(st.current_stock, i.opening_stock) - COALESCE(c.committed, 0)'
    const stockJoin = `
      FROM items i
      LEFT JOIN item_stock st    ON st.item_id = i.id
      LEFT JOIN item_committed c ON c.item_id = i.id
      WHERE i.archived_at IS NULL`

    const belowReorderCount = count(
      `SELECT COUNT(*) AS c ${stockJoin} AND i.reorder_level > 0 AND ${free} <= i.reorder_level`
    )

    const reorderList = itemsRepo
      .list({ stockFilter: 'below_reorder', sort: 'shortfall', limit: 10 })
      .items.map((item) => ({
        code: item.code,
        name: item.name,
        unit: item.unit,
        freeStock: item.freeStock,
        reorderLevel: item.reorderLevel
      }))

    return {
      itemCount: itemsRepo.count(),
      // Only types actually in use are reported, so a shop that never holds assets is
      // not shown a permanent zero.
      byType: ITEM_TYPES.map((t) => ({ type: t.value, label: t.label, count: itemsRepo.count(t.value) })).filter(
        (t) => t.count > 0
      ),
      supplierCount: suppliersRepo.list().length,
      itemsWithoutSupplier: count(
        `SELECT COUNT(*) AS c ${stockJoin} AND NOT EXISTS (SELECT 1 FROM item_suppliers x WHERE x.item_id = i.id)`
      ),
      itemsWithAlternateSuppliers: count(
        `SELECT COUNT(*) AS c ${stockJoin} AND (SELECT COUNT(*) FROM item_suppliers x WHERE x.item_id = i.id) > 1`
      ),
      belowReorderCount,
      negativeStockCount: movesRepo.negativeStockCount(),
      noReorderLevelCount: count(`SELECT COUNT(*) AS c ${stockJoin} AND i.reorder_level <= 0`),
      openOrderCount: ordersRepo.openCount(),
      ordersWithShortage: plansRepo.ordersWithShortage(),
      totalShortageLines: plansRepo.totalShortageLines(),
      movesThisWeek: movesRepo.countSince(startOfToday - 6 * DAY),
      orphanItemCount: itemsRepo.orphans().length,
      activityByDay: movesRepo.activityByDay(14),
      topShortages: plansRepo.topShortages(8),
      reorderList
    }
  }
}
