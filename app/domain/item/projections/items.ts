import type { ItemType } from '../../types'
import { ItemSchema } from '../../types'
import { GEAR_SIZE, getBulkName, getItemCatalog, getItemPrice, isCurrency, scaleItem } from '../rules/items'
import { formatPrice } from './money'

export type ItemCatalogRow = {
  key: string
  name: string
  type: ItemType
  // what it is browsed under: its type, or currency for money of any type
  group: string
  bulk: number
  bulkName: string
  price: string
}

// The catalog as rows to pick from, currency first and then the way the book
// lists them: weapons, armor, then everything else, each in catalog order — at
// the bulk each would have once stamped at `scale`, and at the price it would
// cost.
export function getItemCatalogRows(scale = GEAR_SIZE): ItemCatalogRow[] {
  return Object.entries(getItemCatalog())
    .map(([key, raw]) => {
      const item = scaleItem(ItemSchema.parse(raw), scale)
      return { key, name: item.name || key, type: item.type, group: isCurrency(item) ? 'currency' : item.type, bulk: item.bulk, bulkName: getBulkName(item.bulk), price: formatPrice(getItemPrice(item)) }
    })
    .sort((a, b) => Number(b.group === 'currency') - Number(a.group === 'currency'))
}
