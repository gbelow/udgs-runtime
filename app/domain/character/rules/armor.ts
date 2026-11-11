import { Armor, Character, Item } from '../../types'
import { getItemArmor, getItemScale } from '../../item/rules/items'
import { getDM, getSize } from './size'
import { hasGrant } from './effects'

// The armor the character's body presents: the worn item's, at the size the
// item is made for, over whatever the creature is underneath. A worn item
// that resolves to nothing is treated as not there.
export function getArmor(c: Character): Armor {
  return (c.worn && getItemArmor(c.worn)) || getNaturalArmor(c)
}

// The creature's own hide: the stored one, with what a mutation gives where
// it does better (abilities.tex "Fur": "a natural armor of 2xDM INS";
// "Scales": "a natural armor of +4xDM RES").
export function getNaturalArmor(c: Character): Armor {
  const dm = getDM(c)
  const INS = hasGrant(c, 'fur') ? Math.max(c.armor.INS, 2 * dm) : c.armor.INS
  const RES = hasGrant(c, 'scales') ? Math.max(c.armor.RES, 4 * dm) : c.armor.RES
  return INS === c.armor.INS && RES === c.armor.RES ? c.armor : { ...c.armor, INS, RES }
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
