import { BodyPart, Character, Edge, Handed, Item, Weapon } from '../../types'
import { getCatalogWeapon, getItemWeapon } from './items'
import { getSize, scaleWeapon } from '../../character/rules/size'
import { getWorkingParts } from '../../character/rules/body'

// gear.tex "Small/One/Two hands": a stack is gripped by one hand or two. Any
// number of hands can be free, but no stack takes more than two.
export type Grip = 1 | 2

export function getGrip(c: Character, itemId: string): number {
  return getWorkingParts(c).filter((part) => part.itemId === itemId).length
}

// gear.tex "Gauntlet": a hand that fights unarmed fights with the gauntlet
// while gauntlets are worn.
export function getNaturalWeapon(c: Character, part: BodyPart): string {
  return c.hasGauntlets && part.location === 'hand' && part.naturalWeapon === 'Unarmed' ? 'Gauntlet' : part.naturalWeapon
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
  // gear.tex "Weapon Breakage": the item is broken; a natural weapon never is.
  broken: boolean
  // gear.tex "Gear condition": the item's edge; a natural weapon has none.
  edge: Edge | null
  // gear.tex "Reload": what the item is loaded with; a natural weapon never is.
  loaded: Item['loaded']
}

// Every weapon the character can attack with right now: the held stacks that
// resolve to a catalog weapon, then the natural weapon of each free part —
// a hand's fist, a head's jaws. Free parts sharing a natural weapon pool into
// one entry gripped by all of them,
// so a two-handed natural attack needs two free hands the way a two-handed
// weapon needs two hands on it. A natural weapon is part of the creature, so
// it is the creature's size (gear.tex "Scaling weapons").
export function getWieldedWeapons(c: Character): Wielded[] {
  const known = wielded.get(c)
  if (known) return known
  const computed = computeWieldedWeapons(c)
  wielded.set(c, computed)
  return computed
}

// A character is replaced, never changed, so what it wields is known once for
// each object it is.
const wielded = new WeakMap<Character, Wielded[]>()

function computeWieldedWeapons(c: Character): Wielded[] {
  const held = c.held.flatMap((item) => {
    const weapon = getItemWeapon(item)
    return weapon ? [{ key: item.id, weapon, grip: getGrip(c, item.id), itemId: item.id, natural: false, broken: item.broken, edge: item.edge, loaded: item.loaded }] : []
  })
  const natural = new Map<string, number>()
  for (const part of getFreeParts(c)) {
    const name = getNaturalWeapon(c, part)
    if (name) natural.set(name, (natural.get(name) ?? 0) + 1)
  }
  const fromParts = [...natural].flatMap(([name, grip]) => {
    const weapon = getCatalogWeapon(name)
    return weapon ? [{ key: `natural:${name}`, weapon: scaleWeapon(weapon, getSize(c)), grip, itemId: '', natural: true, broken: false, edge: null, loaded: null }] : []
  })
  return [...held, ...fromParts]
}

// gear.tex "Small/One/Two hands": "Two-handed weapons require both hands".
export function isAttackUsable(handed: Handed, grip: number): boolean {
  return handed === 'two' ? grip >= 2 : grip >= 1
}

// gear.tex "Burden penalties": a shield's penalty counts wherever it is
// carried, in the hands or on the back.
export function getShieldBurden(c: Character): number {
  return [...c.held, ...(c.onBack ? [c.onBack] : [])].reduce((total, item) => total + (getItemWeapon(item)?.shield?.burdenPenalty ?? 0), 0)
}
