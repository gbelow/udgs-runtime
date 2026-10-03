import { Armor, Character, Item } from '../../types'
import { getItemArmor, getItemScale } from '../../item/rules/items'
import { getSize } from './size'

// The armor the character's body presents: the worn item's, at the size the
// item is made for, over whatever the creature is underneath. A worn item
// that resolves to nothing is treated as not there.
export function getArmor(c: Character): Armor {
  return (c.worn && getItemArmor(c.worn)) || c.armor
}

// gear.tex "Closed helmet": a helmet worn with its visor down.
export function isVisorClosed(c: Character): boolean {
  return !!c.hasHelm && !c.visorOpen
}

// gear.tex "Metallic armors": armor made of metal.
export function isMetalArmored(c: Character): boolean {
  return getArmor(c).material === 'metal'
}

// Armor has no oversize allowance: it fits only a wearer of the size it is
// made for. The creature's own hide is its own size by definition.
export function armorFits(c: Character): boolean {
  return c.worn === null || getItemScale(c.worn) === getSize(c)
}

export function isArmorItem(item: Item): boolean {
  return getItemArmor(item) !== undefined
}
