import { Armor, ArmorSchema, Character, Container, ContainerSchema, Item, ItemSchema, Material, SlotGroup, Weapon, WeaponSchema } from '../../types'
import { BULK_NAMES } from '../../lists'
import { MATERIAL_HARDNESS } from '../../tables'
import { scaleArmor, scaleWeapon } from '../../character/rules/helpers'
import weaponsCatalog from '../../../assets/weapons.json'
import armorsCatalog from '../../../assets/armors.json'
import itemsCatalog from '../../../assets/items.json'
import containersCatalog from '../../../assets/containers.json'

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

// gear.tex "Containers and Burden": every container is an item as well, of
// the bulk its row of the Containers table gives, carrying its empty slots.
const containerItems: Record<string, unknown> = Object.fromEntries(
  Object.entries(containersCatalog as Record<string, unknown>).map(([key, raw]) => {
    const container = ContainerSchema.parse(raw)
    return [key, { name: container.name, type: 'container', bulk: container.bulk, refId: key, container }]
  })
)

const catalog: Record<string, unknown> = { ...(itemsCatalog as Record<string, unknown>), ...containerItems }

export function getItemCatalog(): Record<string, unknown> {
  return catalog
}

const templates: Item[] = Object.values(catalog).map((raw) => ItemSchema.parse(raw))

// The template an item was stamped from: the one its refId names, or, for an
// item that is only a name and a description, the one of the same name.
function getTemplate(item: Pick<Item, 'type' | 'refId' | 'name'>): Item | undefined {
  return item.refId
    ? templates.find((t) => t.type === item.type && t.refId === item.refId)
    : templates.find((t) => t.type === item.type && !t.refId && t.name === item.name)
}

export function scaleItem(item: Item, scale: number): Item {
  const steps = scale - GEAR_SIZE
  return { ...item, bulk: item.bulk + steps, ...(item.container ? { container: scaleContainer(item.container, steps) } : {}) }
}

// gear.tex "Scaling a container": "increase the size of every slot and
// increase burden by 1 to scale the container up a size".
function scaleContainer(container: Container, steps: number): Container {
  const { quick, medium, large } = container.slots
  const moved = (group: SlotGroup): SlotGroup => ({ ...group, slotBulk: group.slotBulk + steps })
  return {
    ...container,
    bulk: container.bulk + steps,
    burden: container.burden + steps,
    slots: { quick: moved(quick), medium: moved(medium), large: moved(large) },
  }
}

export function getItemScale(item: Item): number {
  const template = getTemplate(item)
  return template ? GEAR_SIZE + item.bulk - template.bulk : GEAR_SIZE
}

// A catalog entry is a template: stamping it yields an item with its own id
// and a stack of `amount`, so the same key can be drawn from the catalog
// any number of times without two stacks ever sharing an identity. Stamped
// at `scale`, it is that size's copy of the printed item. A container is
// always one: each carries contents of its own.
export function getCatalogItem(key: string, amount = 1, scale = GEAR_SIZE): Item | undefined {
  const raw = catalog[key]
  if (!raw) return undefined
  const item = ItemSchema.parse(raw)
  return scaleItem({ ...item, amount: item.container ? 1 : amount }, scale)
}

// gear.tex "Slot size and stacking": "only identical items can be stacked
// together". Identity is everything a template says — `id` names a stack, not
// an item, and `amount` is how big that stack is. Two containers are never
// identical: what each carries is its own. Nor are two charged items: what a
// charge holds was worked out for its caster, and can be charged over.
export function isSameItem(a: Item, b: Item): boolean {
  return !a.container && !b.container && !a.charge && !b.charge && a.type === b.type && a.refId === b.refId && a.name === b.name
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

// spells.tex "Requirements": whether this is the piece of gear something
// asks for, by the name the book calls it — a better version of the same
// thing answers to it too ("Superior Electrite" is electrite), and an item
// stamped from a catalog row answers to that row's key.
export function isGear(item: Item, name: string): boolean {
  const asked = name.trim().toLowerCase()
  const own = item.name.trim().toLowerCase()
  return own === asked || own.endsWith(` ${asked}`) || item.refId.trim().toLowerCase() === asked
}

// Everything the character has on them: what is in their hands, what they
// wear, and what their containers carry, down through the containers
// carried in them.
export function getCarriedItems(c: Character): Item[] {
  const within = (items: Item[]): Item[] => items.flatMap((item) => [item, ...(item.container ? within(getContents(item.container)) : [])])
  return within([...c.held, ...(c.worn ? [c.worn] : []), ...Object.values(c.containers).flatMap(getContents)])
}

function getContents(container: Container): Item[] {
  return Object.values(container.slots).flatMap((slot) => slot.items)
}
