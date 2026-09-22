import { customAlphabet } from 'nanoid'

// Lowercase + digits only: ids show up in exports and CSV round-trips.
const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 14)

export function newId(prefix: string): string {
  return `${prefix}_${generate()}`
}

export const ids = {
  supplier: () => newId('sp'),
  item: () => newId('it'),
  bomLine: () => newId('bl'),
  order: () => newId('or'),
  move: () => newId('mv'),
  plan: () => newId('pl'),
  planLine: () => newId('pln'),
  itemSupplier: () => newId('isup'),
  packingBox: () => newId('pbx')
}
