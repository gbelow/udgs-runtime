import { CampaignCharacter, Character, Item, SlotKind } from '../../types'
import { getItemWeapon } from './items'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { isCampaignCharacter } from '../../utils'
import { hasProperty } from '../../weaponProperties'

export function hasDraw(item: Item): boolean {
  return getItemWeapon(item)?.attacks.some((atk) => hasProperty(atk.properties, 'draw')) ?? false
}

const times = (cost: ActionCost, n: number): ActionCost => ({ AP: cost.AP * n, STA: cost.STA * n })
const plusAP = (cost: ActionCost, ap: number): ActionCost => ({ AP: cost.AP + ap, STA: cost.STA })

export const FREE: ActionCost = { AP: 0, STA: 0 }

// combat.tex "Drawing items in combat": from any slot but a quick one, 4 AP on
// top of a standard action. From a quick slot an item up to small or a weapon
// with draw is free, a medium item is a standard action and a large one two.
export function getDrawCost(c: Character, slot: SlotKind, item: Item): ActionCost {
  const standard = getActionCost(c, 'standardAction')
  if (slot !== 'quick') return plusAP(standard, 4)
  if (item.bulk <= 1 || hasDraw(item)) return FREE
  if (item.bulk === 2) return standard
  return times(standard, 2)
}

// combat.tex "Putting items away": an item up to small or a weapon with draw
// goes into a quick slot for a standard action; anything else, anywhere, is
// 4 AP more. Dropping is free.
export function getStoreCost(c: Character, slot: SlotKind, item: Item): ActionCost {
  const standard = getActionCost(c, 'standardAction')
  if (slot === 'quick' && (item.bulk <= 1 || hasDraw(item))) return standard
  return plusAP(standard, 4)
}

// Only a character in play has AP to spend; on the sheet every move is free.
export function isCharged(c: Character): c is CampaignCharacter {
  return isCampaignCharacter(c)
}

