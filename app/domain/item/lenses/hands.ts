import { SPELLS, isSpellKey } from '../../spells'
import { Character, Hand, Handed, Item, SlotKind, Weapon } from '../../types'
import { getBulkName, getCatalogWeapon, getItemScale, getItemWeapon } from './items'
import { getDrawCost, isCharged } from './costs'
import { getSize } from '../../character/rules/misc'
import { scaleWeapon } from '../../character/rules/helpers'
import { getWearView, WearView } from '../../character/rules/armor'
import { isHandWounded } from '../../character/rules/wounds'

export { hasDraw, getDrawCost, getStoreCost, isCharged, FREE } from './costs'

// gear.tex "Small/One/Two hands": a stack is gripped by one hand or two. Any
// number of hands can be free, but no stack takes more than two.
export type Grip = 1 | 2

// The hands that are there to be used: combat.tex "Wounds" takes a broken
// or amputated hand out of the count, whatever it was holding.
function getSoundHands(c: Character): Hand[] {
  return c.hands.filter((_, index) => !isHandWounded(c, index))
}

export function getGrip(c: Character, itemId: string): number {
  return getSoundHands(c).filter((hand) => hand.itemId === itemId).length
}

export function getHeldItem(c: Character, itemId: string): Item | undefined {
  return c.held.find((item) => item.id === itemId)
}

// A free hand fights with its natural weapon; a free hand that can hold is the
// one that may take gear.
export function getFreeHands(c: Character): Hand[] {
  return getSoundHands(c).filter((hand) => hand.itemId === '')
}

export function getFreeHoldingHands(c: Character): Hand[] {
  return getFreeHands(c).filter((hand) => hand.canHold)
}

// gear.tex "Hands": "can carry an item up to one bulk higher than the
// character's size without penalty. Carrying something up to 3 bulk higher is
// possible, but makes the character lame." Holding is about bulk; whether a
// held weapon can be fought with is about its size (isWieldable).
export function canBeHeld(c: Character, item: Item): boolean {
  return item.bulk <= getSize(c) + 2
}

export function isLamingHold(c: Character, item: Item): boolean {
  return item.bulk > getSize(c) + 1
}

export function isLamedByHeld(c: Character): boolean {
  return c.held.some((item) => isLamingHold(c, item))
}

export function canHoldWith(c: Character, item: Item, grip: Grip): boolean {
  return canBeHeld(c, item) && getFreeHoldingHands(c).length >= grip
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
// weapon needs two hands on it. A natural weapon is part of the creature, so
// it is the creature's size (gear.tex "Scaling weapons").
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
    return weapon ? [{ key: `natural:${name}`, weapon: scaleWeapon(weapon, getSize(c)), grip, itemId: '', natural: true }] : []
  })
  return [...held, ...fromHands]
}

// gear.tex "Small/One/Two hands": "Two-handed weapons require both hands".
export function isAttackUsable(handed: Handed, grip: number): boolean {
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
  scale: number
  grip: number
  // gear.tex "Hands": more than one bulk over the holder's size lames them.
  laming: boolean
  // Whether the stack could be regripped to that many hands. Moving between
  // one and two hands costs nothing (gear.tex "Small/One/Two hands").
  canGrip: Record<Grip, boolean>
  // For an armor item, whether it could be put on from here; null otherwise.
  wear: WearView | null
  // spells.tex "Charged": the spell loaded into it, by name; '' for none
  charge: string
}

export type HandsPanelView = {
  hands: HandView[]
  held: HeldItemView[]
  freeHolding: number
  // For the item being placed, whether the hands could take it as is, and
  // whether taking it would lame the holder.
  canHold: Record<Grip, boolean> | null
  lamingHold: boolean
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
        scale: getItemScale(item),
        grip,
        laming: isLamingHold(c, item),
        canGrip: { 1: grip !== 1, 2: grip !== 2 && freeHolding >= 1 },
        wear: getWearView(c, null, item),
        charge: item.charge && isSpellKey(item.charge) ? SPELLS[item.charge].name : '',
      }
    }),
    freeHolding,
    canHold: pending ? { 1: canHoldWith(c, pending, 1), 2: canHoldWith(c, pending, 2) } : null,
    lamingHold: pending ? isLamingHold(c, pending) : false,
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
