import { BodyPart, Character, Handed, Item, Weapon } from '../../types'
import { getCatalogWeapon, getItemWeapon } from './items'
import { getSize } from '../../character/rules/misc'
import { scaleWeapon } from '../../character/rules/helpers'
import { getWorkingParts } from '../../character/rules/body'

export { hasDraw, getDrawCost, getStoreCost, isCharged, FREE } from './costs'

// gear.tex "Small/One/Two hands": a stack is gripped by one hand or two. Any
// number of hands can be free, but no stack takes more than two.
export type Grip = 1 | 2

export function getGrip(c: Character, itemId: string): number {
  return getWorkingParts(c).filter((part) => part.itemId === itemId).length
}

export function getHeldItem(c: Character, itemId: string): Item | undefined {
  return c.held.find((item) => item.id === itemId)
}

// A free part fights with its natural weapon, if it has one; a free part that
// grips is a hand that may take gear.
export function getFreeParts(c: Character): BodyPart[] {
  return getWorkingParts(c).filter((part) => part.itemId === '')
}

export function getFreeHoldingHands(c: Character): BodyPart[] {
  return getFreeParts(c).filter((part) => part.grip)
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
// resolve to a catalog weapon, then the natural weapon of each free part —
// a hand's fist, a head's jaws. Free parts sharing a natural weapon pool into
// one entry gripped by all of them,
// so a two-handed natural attack needs two free hands the way a two-handed
// weapon needs two hands on it. A natural weapon is part of the creature, so
// it is the creature's size (gear.tex "Scaling weapons"). A stack a
// grappler has seized is held but not wielded (combat.tex "Disarm").
export function getWieldedWeapons(c: Character): Wielded[] {
  const held = c.held.filter((item) => !item.seized).flatMap((item) => {
    const weapon = getItemWeapon(item)
    return weapon ? [{ key: item.id, weapon, grip: getGrip(c, item.id), itemId: item.id, natural: false }] : []
  })
  const natural = new Map<string, number>()
  for (const part of getFreeParts(c)) {
    if (part.naturalWeapon) natural.set(part.naturalWeapon, (natural.get(part.naturalWeapon) ?? 0) + 1)
  }
  const fromParts = [...natural].flatMap(([name, grip]) => {
    const weapon = getCatalogWeapon(name)
    return weapon ? [{ key: `natural:${name}`, weapon: scaleWeapon(weapon, getSize(c)), grip, itemId: '', natural: true }] : []
  })
  return [...held, ...fromParts]
}

// gear.tex "Small/One/Two hands": "Two-handed weapons require both hands".
export function isAttackUsable(handed: Handed, grip: number): boolean {
  return handed === 'two' ? grip >= 2 : grip >= 1
}
