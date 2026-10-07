import { Ammo, AmmoSchema, Character, Item, Weapon, WeaponAttack } from '../../types'
import { getOpenContainers } from './containers'
import { getItemScale } from './items'
import ammoCatalog from '../../../assets/ammo.json'

// The arrow or bolt an item is, as the ammunition catalog gives it.
export function getItemAmmo(item: Item): Ammo | undefined {
  return item.type === 'ammo' ? getCatalogAmmo(item.refId) : undefined
}

function getCatalogAmmo(refId: string): Ammo | undefined {
  const raw = refId ? (ammoCatalog as Record<string, unknown>)[refId] : undefined
  return raw ? AmmoSchema.parse(raw) : undefined
}

// gear.tex "Reload": the arrow or bolt the weapon was loaded with.
export function getLoadedAmmo(weapon: Pick<Item, 'loaded'>): Ammo | null {
  return (weapon.loaded && getCatalogAmmo(weapon.loaded.refId)) ?? null
}

export function getAmmoStackName(stack: AmmoStack): string {
  return stack.ammo.name || stack.item.name
}

export type AmmoStack = { containerKey: string; item: Item; ammo: Ammo }

// Every stack of ammunition in a quick slot of an open container, slung
// quivers included: gear.tex "Quiver", "carries 20 arrows or bolts that cost
// nothing to be drawn", as combat.tex "Drawing items in combat" makes any
// small item in a quick slot.
export function getQuickAmmo(c: Character): AmmoStack[] {
  return Object.entries(getOpenContainers(c)).flatMap(([containerKey, container]) =>
    container.slots.quick.items.flatMap((item) => {
      const ammo = getItemAmmo(item)
      return ammo ? [{ containerKey, item, ammo }] : []
    }))
}

// What the row can be loaded with right now: its own kind of ammunition,
// made for a weapon of its size — an arrow is scaled along with the bow
// (the table's ruling). Empty for a row that loads nothing.
export function getLoadableAmmo(c: Character, weapon: Weapon, atk: WeaponAttack): AmmoStack[] {
  if (!atk.ammo) return []
  return getQuickAmmo(c).filter((s) => s.ammo.kind === atk.ammo && getItemScale(s.item) === weapon.scale)
}

export function findAmmoStack(c: Character, itemId: string): AmmoStack | undefined {
  return itemId ? getQuickAmmo(c).find((s) => s.item.id === itemId) : undefined
}
