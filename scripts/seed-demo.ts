/**
 * Loads the scenario from `Stock Register System.xlsm` into a real StockFlow database,
 * so the app can be opened against recognisable data. Not shipped — a developer tool.
 */
import { join } from 'node:path'
import { openDatabase, closeDatabase } from '../src/main/db/connection'
import { suppliersRepo } from '../src/main/db/suppliers'
import { itemsRepo } from '../src/main/db/items'
import { bomRepo } from '../src/main/db/bom'
import { ordersRepo } from '../src/main/db/orders'
import { movesRepo } from '../src/main/db/moves'
import { settingsRepo } from '../src/main/db/settings'
import { planOrder } from '../src/main/services/planning'

const userData = process.argv[2]
if (!userData) throw new Error('usage: seed-demo <userDataPath>')
openDatabase(userData)

settingsRepo.update({
  companyName: 'Demo Manufacturing Co.',
  defaultUnit: 'Nos.',
  onboardingCompletedAt: Date.now()
})

const bomQty: Record<string, number> = {
  'RM-01': 1, 'RM-02': 2, 'RM-03': 4, 'RM-04': 2, 'RM-05': 1,
  'RM-06': 2, 'RM-07': 4, 'RM-08': 6, 'RM-09': 7
}
const rm: Record<string, string> = {}
let n = 1
for (const code of Object.keys(bomQty)) {
  const supplier = suppliersRepo.ensure(`S-${n}`, `C-${n}`)
  suppliersRepo.update(supplier!.id, { leadTimeDays: 3 + (n % 5), phone: `+91 90000 000${String(n).padStart(2, '0')}` })
  const { item } = itemsRepo.create({
    code, name: 'ABC', unit: 'Nos.', type: 'RM',
    openingStock: 10, reorderLevel: 10,
    supplierId: supplier?.id ?? null,
    location: `A-${n}`,
    netWeight: 0.4 + n / 20,
    grossWeight: 0.5 + n / 20,
    quantityPacked: 24,
    packingBoxDetails: 'Carton 300x200x150'
  })
  rm[code] = item.id
  n++
}

const { item: fg } = itemsRepo.create({
  code: 'AEH-01', name: 'AEH-01 Assembly', unit: 'Nos.', type: 'FG',
  netWeight: 12, grossWeight: 14.5, quantityPacked: 4, packingBoxDetails: 'Wooden crate 600x400x400',
  location: 'FG-1', reorderLevel: 5
})
for (const [code, qty] of Object.entries(bomQty)) {
  bomRepo.addLine({ fgItemId: fg.id, rmItemId: rm[code]!, qtyPerUnit: qty })
}

// The workbook's Material_Log: one inward on RM-01.
movesRepo.create({ itemId: rm['RM-01']!, direction: 'in', qty: 1, reason: 'purchase', referenceNo: 'INV-1' })

const { order: o55 } = ordersRepo.create({
  orderNo: '55', orderDate: Date.UTC(2025, 9, 25), fgItemId: fg.id, qtyOrdered: 2,
  customer: 'Anand Engineering', dueDate: Date.now() + 9 * 86_400_000
})
const { order: o56 } = ordersRepo.create({
  orderNo: '56', orderDate: Date.UTC(2025, 9, 26), fgItemId: fg.id, qtyOrdered: 3,
  customer: 'Bharat Motors', dueDate: Date.now() + 4 * 86_400_000
})
planOrder(o55.id)
planOrder(o56.id)

console.log('seeded into', join(userData, 'data', 'stockflow.db'))
closeDatabase()
