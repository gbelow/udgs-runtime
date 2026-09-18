import { Armor, ArmorSchema, Item, ItemSchema, ItemType, Weapon, WeaponSchema } from '../../types'
import { BULK_NAMES } from '../../lists'
import { scaleWeapon } from '../../character/lenses/helpers'
import weaponsCatalog from '../../../assets/weapons.json'
import armorsCatalog from '../../../assets/armors.json'
import itemsCatalog from '../../../assets/items.json'

export function getBulkName(bulk: number): string {
  return BULK_NAMES[bulk] ?? `bulk ${bulk}`
}

export type ItemCatalogRow = {
  key: string
  name: string
  type: ItemType
  bulk: number
  bulkName: string
}

// The catalog as rows to pick from, grouped the way the book lists them:
// weapons, armor, then everything else, each in catalog order.
export function getItemCatalogRows(): ItemCatalogRow[] {
  return Object.entries(itemsCatalog as Record<string, unknown>)
    .map(([key, raw]) => {
      const item = ItemSchema.parse(raw)
      return { key, name: item.name || key, type: item.type, bulk: item.bulk, bulkName: getBulkName(item.bulk) }
    })
}

// A catalog entry is a template: stamping it yields an item with its own id
// and a stack of `amount`, so the same key can be drawn from the catalog
// any number of times without two stacks ever sharing an identity.
export function getCatalogItem(key: string, amount = 1): Item | undefined {
  const raw = (itemsCatalog as Record<string, unknown>)[key]
  return raw ? ItemSchema.parse({ ...(raw as object), amount }) : undefined
}

// gear.tex "Slot size and stacking": "only identical items can be stacked
// together". Identity is everything a template says — `id` names a stack, not
// an item, and `amount` is how big that stack is.
export function isSameItem(a: Item, b: Item): boolean {
  return a.type === b.type && a.refId === b.refId && a.name === b.name
    && a.description === b.description && a.bulk === b.bulk
}

// gear.tex "Size Scaling": "Every piece of gear in the list is made for a
// size 3 creature", and "Containers and Burden": scaling an item "also scales
// item bulk by the same amount". So how far an item's bulk sits from its
// template's is how far it has been scaled from size 3. An item with no
// template in the catalog has nothing to be measured against and is size 3.
export const GEAR_SIZE = 3

export function getItemScale(item: Item): number {
  const template = Object.values(itemsCatalog as Record<string, unknown>)
    .map((raw) => ItemSchema.parse(raw))
    .find((t) => t.type === item.type && t.refId === item.refId)
  return template ? GEAR_SIZE + item.bulk - template.bulk : GEAR_SIZE
}

// resolves what a refId'd item actually is, so e.g. a weapon sitting in a
// backpack can be equipped as the real thing rather than staying a wrapper —
// at the size the item has been scaled to (gear.tex "Scaling weapons").
export function getItemWeapon(item: Item): Weapon | undefined {
  if (item.type !== 'weapon' || !item.refId) return undefined
  const weapon = getCatalogWeapon(item.refId)
  return weapon && scaleWeapon(weapon, getItemScale(item))
}

// The catalog weapon as printed, made for a size 3 creature.
export function getCatalogWeapon(key: string): Weapon | undefined {
  const raw = (weaponsCatalog as Record<string, unknown>)[key]
  return raw ? WeaponSchema.parse(raw) : undefined
}

export function getItemArmor(item: Item): Armor | undefined {
  if (item.type !== 'armor' || !item.refId) return undefined
  const raw = (armorsCatalog as Record<string, unknown>)[item.refId]
  return raw ? ArmorSchema.parse(raw) : undefined
}
