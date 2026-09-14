import { CampaignCharacter, Character, Hand, Item, SlotKind, Weapon } from '../../types'
import { getBulkName, getCatalogWeapon, getItemWeapon } from './items'
import { ActionCost, getActionCost } from '../../character/lenses/actionCosts'
import { isCampaignCharacter } from '../../utils'

// gear.tex "Small/One/Two hands": a stack is gripped by one hand or two. Any
// number of hands can be free, but no stack takes more than two.
export type Grip = 1 | 2

export function getGrip(c: Character, itemId: string): number {
  return c.hands.filter((hand) => hand.itemId === itemId).length
}

export function getHeldItem(c: Character, itemId: string): Item | undefined {
  return c.held.find((item) => item.id === itemId)
}

// A free hand fights with its natural weapon; a free hand that can hold is the
// one that may take gear.
export function getFreeHands(c: Character): Hand[] {
  return c.hands.filter((hand) => hand.itemId === '')
}

export function getFreeHoldingHands(c: Character): Hand[] {
  return getFreeHands(c).filter((hand) => hand.canHold)
}

// gear.tex "Hands": "Items held in hands can be of any size" — cargo is a
// measure of large items, not a thing, so it alone is never held.
export function canBeHeld(item: Item): boolean {
  return item.bulk < 3
}

export function canHoldWith(c: Character, item: Item, grip: Grip): boolean {
  return canBeHeld(item) && getFreeHoldingHands(c).length >= grip
}

export function hasDraw(item: Item): boolean {
  return getItemWeapon(item)?.attacks.some((atk) => atk.props.draw) ?? false
}

const times = (cost: ActionCost, n: number): ActionCost => ({ AP: cost.AP * n, STA: cost.STA * n })
const plusAP = (cost: ActionCost, ap: number): ActionCost => ({ AP: cost.AP + ap, STA: cost.STA })

export const FREE: ActionCost = { AP: 0, STA: 0 }

// combat.tex "Drawing items in combat": from any slot but a quick one, 4 AP on
// top of a standard action. From a quick slot a small item or a weapon with
// draw is free, a medium item is a standard action and a large one two.
export function getDrawCost(c: Character, slot: SlotKind, item: Item): ActionCost {
  const standard = getActionCost(c, 'standardAction')
  if (slot !== 'quick') return plusAP(standard, 4)
  if (item.bulk === 0 || hasDraw(item)) return FREE
  if (item.bulk === 1) return standard
  return times(standard, 2)
}

// combat.tex "Putting items away": a small item or a weapon with draw goes into
// a quick slot for a standard action; anything else, anywhere, is 4 AP more.
// Dropping is free.
export function getStoreCost(c: Character, slot: SlotKind, item: Item): ActionCost {
  const standard = getActionCost(c, 'standardAction')
  if (slot === 'quick' && (item.bulk === 0 || hasDraw(item))) return standard
  return plusAP(standard, 4)
}

// Only a character in play has AP to spend; on the sheet every move is free.
export function isCharged(c: Character): c is CampaignCharacter {
  return isCampaignCharacter(c)
}

export type Wielded = {
  key: string
  weapon: Weapon
  grip: number
  // '' for a natural weapon, which is not an item.
  itemId: string
  natural: boolean
}

// Every weapon the character can attack with right now: the held stacks that
// resolve to a catalog weapon, then the natural weapon of each free hand. Free
// hands sharing a natural weapon pool into one entry gripped by all of them,
// so a two-handed natural attack needs two free hands the way a two-handed
// weapon needs two hands on it.
export function getWieldedWeapons(c: Character): Wielded[] {
  const held = c.held.flatMap((item) => {
    const weapon = getItemWeapon(item)
    return weapon ? [{ key: item.id, weapon, grip: getGrip(c, item.id), itemId: item.id, natural: false }] : []
  })
  const natural = new Map<string, number>()
  for (const hand of getFreeHands(c)) {
    if (hand.naturalWeapon) natural.set(hand.naturalWeapon, (natural.get(hand.naturalWeapon) ?? 0) + 1)
  }
  const fromHands = [...natural].flatMap(([name, grip]) => {
    const weapon = getCatalogWeapon(name)
    return weapon ? [{ key: `natural:${name}`, weapon, grip, itemId: '', natural: true }] : []
  })
  return [...held, ...fromHands]
}

// gear.tex "Small/One/Two hands": "Two-handed weapons require both hands".
export function isAttackUsable(handed: string, grip: number): boolean {
  return handed === 'two' ? grip >= 2 : grip >= 1
}

export type HandView = {
  index: number
  name: string
  canHold: boolean
  naturalWeapon: string
  item: { id: string; name: string } | null
}

export type HeldItemView = {
  id: string
  name: string
  amount: number
  bulkName: string
  grip: number
  // Whether the stack could be regripped to that many hands. Moving between
  // one and two hands costs nothing (gear.tex "Small/One/Two hands").
  canGrip: Record<Grip, boolean>
}

export type HandsPanelView = {
  hands: HandView[]
  held: HeldItemView[]
  freeHolding: number
  // For the item being placed, whether the hands could take it as is.
  canHold: Record<Grip, boolean> | null
}

export function getHandsPanel(c: Character, pending?: Item): HandsPanelView {
  const freeHolding = getFreeHoldingHands(c).length
  return {
    hands: c.hands.map((hand, index) => {
      const item = hand.itemId ? getHeldItem(c, hand.itemId) : undefined
      return {
        index,
        name: hand.name,
        canHold: hand.canHold,
        naturalWeapon: hand.naturalWeapon,
        item: item ? { id: item.id, name: item.name || item.refId } : null,
      }
    }),
    held: c.held.map((item) => {
      const grip = getGrip(c, item.id)
      return {
        id: item.id,
        name: item.name || item.refId,
        amount: item.amount,
        bulkName: getBulkName(item.bulk),
        grip,
        canGrip: { 1: grip !== 1, 2: grip !== 2 && freeHolding >= 1 },
      }
    }),
    freeHolding,
    canHold: pending ? { 1: canHoldWith(c, pending, 1), 2: canHoldWith(c, pending, 2) } : null,
  }
}

// A container's stack as the hands see it: whether it could be drawn right
// now, and what that would cost a character in play.
export function getDrawView(c: Character, slot: SlotKind, item: Item): { drawable: boolean; drawCost: number | null } {
  return {
    drawable: canHoldWith(c, item, 1),
    drawCost: isCharged(c) ? getDrawCost(c, slot, item).AP : null,
  }
}
