import type { Character, Item } from '../../types'
import type { AttackAction } from '../types'
import type { Breakable } from '../../character/rules/breakage'
import { getItemArmor, getItemWeapon } from '../../item/rules/items'
import { getHeldItem } from '../../item/rules/hands'

// combat.tex "Attack against equipment": "An attack can be made against a
// weapon, shield, or any object in order to break them." A strike aimed at an
// item the target holds is scored as a strike at its holder, with a penalty
// like the hand's (the table's ruling), and what it lands on is the item. A
// shot aimed at one is scored the same way.
export const EQUIPMENT_ATTACK_PENALTY = 10

export function isObjectAttack(action: AttackAction): boolean {
  return action.object !== ''
}

// An attack aimed at an item lying on the floor: it names the item and no
// character.
export function isFloorAttack(action: AttackAction): boolean {
  return isObjectAttack(action) && action.targetId === null
}

// The items the target holds that a strike can be aimed at: weapons and
// shields, while whole.
function isAimable(item: Item): boolean {
  return !item.broken && getItemWeapon(item) !== undefined
}

export function getAimableItems(target: Character): Item[] {
  return target.held.filter(isAimable)
}

// Whether the item aimed at, if any, is one the target holds.
export function isObjectOnTarget(target: Character | undefined, objectId: string | undefined): boolean {
  const item = objectId && target ? getHeldItem(target, objectId) : undefined
  return !objectId || (!!item && isAimable(item))
}

// gear.tex "RES: indicates RES of that part of the weapon, which is the
// threshold for gear breakage": a blow at the weapon finds its weakest part
// (the table's ruling), the shaft of a spear before its head.
export function getWeakestPart(item: Item): Breakable | null {
  const weakest = [...(getItemWeapon(item)?.attacks ?? [])].sort((a, b) => a.RES - b.RES)[0]
  return weakest ? { RES: weakest.RES } : null
}

// What a blow tests on an object: its weapon's weakest part, or the RES of an
// armor. Null for an object without a RES, which a blow cannot break.
export function getObjectPart(item: Item): Breakable | null {
  const armor = getItemArmor(item)
  return getWeakestPart(item) ?? (armor ? { RES: armor.RES } : null)
}
