import { Armor, ArmorSchema, Item, ItemSchema, ItemType, Material, Weapon, WeaponSchema } from '../../types'
import { BULK_NAMES } from '../../lists'
import { MATERIAL_HARDNESS } from '../../tables'
import { scaleArmor, scaleWeapon } from '../../character/rules/helpers'
import weaponsCatalog from '../../../assets/weapons.json'
import armorsCatalog from '../../../assets/armors.json'
import itemsCatalog from '../../../assets/items.json'

// combat.tex "What cuts?": what a material can cut or break is decided by its
// hardness, so every attack and armor reads it off its material.
export function getHardness(material: Material): number {
  return MATERIAL_HARDNESS[material]
}

export function getBulkName(bulk: number): string {
  return BULK_NAMES[bulk] ?? `bulk ${bulk}`
}

// gear.tex "Size Scaling": "Every piece of gear in the list is made for a
// size 3 creature", and "Containers and Burden": scaling an item "also scales
// item bulk by the same amount". So an item's scale is carried by its bulk:
// stamping a template at size k moves its bulk by k - 3, and how far a bulk
// sits from its template's is how far the item has been scaled. An item with
// no template in the catalog has nothing to be measured against and is size 3.
export const GEAR_SIZE = 3

const templates: Item[] = Object.values(itemsCatalog as Record<string, unknown>).map((raw) => ItemSchema.parse(raw))

// The template an item was stamped from: the one its refId names, or, for an
// item that is only a name and a description, the one of the same name.
function getTemplate(item: Pick<Item, 'type' | 'refId' | 'name'>): Item | undefined {
  return item.refId
    ? templates.find((t) => t.type === item.type && t.refId === item.refId)
    : templates.find((t) => t.type === item.type && !t.refId && t.name === item.name)
}

function scaleItem(item: Item, scale: number): Item {
  return { ...item, bulk: item.bulk + scale - GEAR_SIZE }
}

export function getItemScale(item: Item): number {
  const template = getTemplate(item)
  return template ? GEAR_SIZE + item.bulk - template.bulk : GEAR_SIZE
}

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

// A catalog entry is a template: stamping it yields an item with its own id
// and a stack of `amount`, so the same key can be drawn from the catalog
// any number of times without two stacks ever sharing an identity. Stamped
// at `scale`, it is that size's copy of the printed item.
export function getCatalogItem(key: string, amount = 1, scale = GEAR_SIZE): Item | undefined {
  const raw = (itemsCatalog as Record<string, unknown>)[key]
  return raw ? scaleItem(ItemSchema.parse({ ...(raw as object), amount }), scale) : undefined
}

// gear.tex "Slot size and stacking": "only identical items can be stacked
// together". Identity is everything a template says — `id` names a stack, not
// an item, and `amount` is how big that stack is.
export function isSameItem(a: Item, b: Item): boolean {
  return a.type === b.type && a.refId === b.refId && a.name === b.name
    && a.description === b.description && a.bulk === b.bulk
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

// The armor an item is, at the size the item has been scaled to.
export function getItemArmor(item: Item): Armor | undefined {
  if (item.type !== 'armor' || !item.refId) return undefined
  const raw = (armorsCatalog as Record<string, unknown>)[item.refId]
  return raw ? scaleArmor(ArmorSchema.parse(raw), getItemScale(item)) : undefined
}
