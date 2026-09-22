import type { ItemType } from '../../types'
import { ItemSchema } from '../../types'
import itemsCatalog from '../../../assets/items.json'
import { GEAR_SIZE, getBulkName, scaleItem } from '../rules/items'

export type ItemCatalogRow = {
  key: string
  name: string
  type: ItemType
  bulk: number
  bulkName: string
}

// The catalog as rows to pick from, grouped the way the book lists them:
// weapons, armor, then everything else, each in catalog order — at the bulk
// each would have once stamped at `scale`.
export function getItemCatalogRows(scale = GEAR_SIZE): ItemCatalogRow[] {
  return Object.entries(itemsCatalog as Record<string, unknown>)
    .map(([key, raw]) => {
      const item = scaleItem(ItemSchema.parse(raw), scale)
      return { key, name: item.name || key, type: item.type, bulk: item.bulk, bulkName: getBulkName(item.bulk) }
    })
}
