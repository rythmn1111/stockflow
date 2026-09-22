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
import { itemSuppliersRepo } from '../src/main/db/item-suppliers'
import { packingBoxesRepo } from '../src/main/db/packing-boxes'
import { planOrder } from '../src/main/services/planning'

const userData = process.argv[2]
if (!userData) throw new Error('usage: seed-demo <userDataPath>')
openDatabase(userData)

settingsRepo.update({
  companyName: 'Demo Manufacturing Co.',
  defaultUnit: 'Nos.',
  onboardingCompletedAt: Date.now()
})

// The editable box list, which items then choose from.
const carton = packingBoxesRepo.create({
  label: 'Carton 300×200×150', lengthMm: 300, widthMm: 200, heightMm: 150, emptyWeight: 0.12
})
const crate = packingBoxesRepo.create({
  label: 'Wooden crate 600×400×400', lengthMm: 600, widthMm: 400, heightMm: 400, emptyWeight: 2.4
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
    suppliers: supplier ? [{ supplierId: supplier.id }] : [],
    location: 'Store A',
    rack: `R-${n}`,
    packingBoxId: carton.box?.id ?? null,
    netWeight: 0.4 + n / 20,
    grossWeight: 0.5 + n / 20,
    quantityPacked: 24,
  })
  rm[code] = item.id
  n++
}

const { item: fg } = itemsRepo.create({
  code: 'AEH-01', name: 'AEH-01 Assembly', unit: 'Nos.', type: 'FG',
  netWeight: 12, grossWeight: 14.5, quantityPacked: 4,
  packingBoxId: crate.box?.id ?? null,
  location: 'Dispatch', rack: 'D-1', reorderLevel: 5
})
for (const [code, qty] of Object.entries(bomQty)) {
  bomRepo.addLine({ fgItemId: fg.id, rmItemId: rm[code]!, qtyPerUnit: qty })
}

// A second and third source for one part, so the supplier card and the preferred-source
// rule have something real to show.
const altA = suppliersRepo.create({ name: 'Metro Fasteners', contact: 'Priya', phone: '+91 90000 11111', leadTimeDays: 2 })
const altB = suppliersRepo.create({ name: 'Global Components', contact: 'Rahul', phone: '+91 90000 22222', leadTimeDays: 12 })
itemSuppliersRepo.attach(rm['RM-03']!, altA.id, { unitPrice: 14.5, supplierSku: 'MF-3300', leadTimeDays: 2 })
itemSuppliersRepo.attach(rm['RM-03']!, altB.id, { unitPrice: 11.2, supplierSku: 'GC-88-B' })
itemSuppliersRepo.attach(rm['RM-08']!, altA.id, { unitPrice: 6.75, supplierSku: 'MF-8100' })

// A few of the new item types, so the type filter is not all RM and FG.
itemsRepo.create({
  code: 'WIP-01', name: 'Sub-frame assembly', unit: 'Nos.', type: 'WIP',
  openingStock: 4, location: 'Store A', rack: 'R-10'
})
itemsRepo.create({
  code: 'CON-01', name: 'Cutting fluid', unit: 'L', type: 'CONSUMABLE',
  openingStock: 40, reorderLevel: 20, location: 'Store B', rack: 'R-1',
  suppliers: [{ supplierId: altA.id, unitPrice: 320 }]
})
itemsRepo.create({
  code: 'AST-01', name: 'Bench drill', unit: 'Nos.', type: 'ASSET',
  openingStock: 1, location: 'Workshop'
})
itemsRepo.create({
  code: 'BO-01', name: 'Packaged bearing set', unit: 'Nos.', type: 'BOUGHT_OUT',
  openingStock: 25, reorderLevel: 10, location: 'Store B', rack: 'R-4',
  suppliers: [{ supplierId: altB.id, unitPrice: 890, supplierSku: 'GC-BRG' }]
})

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
