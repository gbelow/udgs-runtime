import { CampaignCharacter, Character, Item, SlotKind } from '../../types'
import { getItemWeapon } from './items'
import { canHoldWith } from './hands'
import { getDisplacedContainer } from './containers'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { isCampaignCharacter } from '../../utils'
import { hasProperty } from '../../weaponProperties'

export function hasDraw(item: Item): boolean {
  return getItemWeapon(item)?.attacks.some((atk) => hasProperty(atk.properties, 'draw')) ?? false
}

const times = (cost: ActionCost, n: number): ActionCost => ({ AP: cost.AP * n, STA: cost.STA * n })
const plusAP = (cost: ActionCost, ap: number): ActionCost => ({ AP: cost.AP + ap, STA: cost.STA })

// Whether a move with an item can be made, what it costs a character in play
// (null on the sheet), and why not.
export type MoveView = { able: boolean; cost: number | null; why: string }

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

// Whether a container item can be put on from where it is — the catalog
// (null), the hands, or a slot — and what it costs a character in play: a
// slot's draw price (combat.tex "Drawing items in combat"), from the hands
// nothing. Only a catalog pick on the sheet goes over whatever it displaces,
// which is how a character is dressed; anywhere else the other comes off
// first. A quiver is not put on but slung (gear.tex "Quiver"). Null for an
// item that is not a container one can put on.
export function getPutOnView(c: Character, from: SlotKind | 'hand' | null, item: Item): MoveView | null {
  if (!item.container || item.container.kind === 'quiver') return null
  const displaced = getDisplacedContainer(c, item)
  if (displaced && (from !== null || isCharged(c))) return { able: false, cost: null, why: `take off the ${displaced.name} first` }
  if (!isCharged(c)) return { able: true, cost: null, why: '' }
  const cost = from === null || from === 'hand' ? FREE : getDrawCost(c, from, item)
  return { able: true, cost: cost.AP, why: '' }
}

// gear.tex "Shields": a shield "carries its own" strap, so it is slid to the
// back or back to the front with a standard action, and "throwing the shield
// out also costs a standard action". On the sheet each is free.
export function getBackMoveCost(c: Character): number | null {
  return isCharged(c) ? getActionCost(c, 'standardAction').AP : null
}

function backMove(c: Character, why: string): MoveView {
  return { able: why === '', cost: getBackMoveCost(c), why }
}

// Null for a held item that is not a shield.
export function getSlingView(c: Character, item: Item): MoveView | null {
  if (getItemWeapon(item)?.shield === undefined) return null
  return backMove(c, c.onBack ? `the ${c.onBack.name || c.onBack.refId} is on the back` : '')
}

export function getUnslingView(c: Character, item: Item): MoveView {
  return backMove(c, canHoldWith(c, item, 1) ? '' : 'no free hand')
}
