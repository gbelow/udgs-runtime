import type { Character, Item } from '../../types'
import { getConsume, getDosesLeft } from './consumables'
import { getCarriedItems, getHeldConsumables } from './items'
import { getSize, getVMAt } from '../../character/rules/size'

// gear.tex "Potions and Medicine": "The contents of a potion on the list are
// relative to a creature of size 3. A creature of a different size will
// consume an amount equivalent to 1x Volume Modifier" — the doses one
// taking takes, never less than one.
export function getDoseCount(c: Character): number {
  return Math.max(1, Math.ceil(getVMAt(getSize(c))))
}

// gear.tex "Anti-septic": "when applied with a bandage" — what the item is
// applied with, carried with doses enough for one taking.
export function getAppliedWith(c: Character, item: Item): Item | null {
  const name = getConsume(item)?.with ?? ''
  if (!name) return null
  return getCarriedItems(c).find((i) => i.name === name && getDosesLeft(i) >= getDoseCount(c)) ?? null
}

// Why the character cannot take a dose of the item now, or null.
export function getConsumeBar(c: Character, item: Item): string | null {
  const consume = getConsume(item)
  if (!consume?.taken) return 'nothing to take'
  const doses = getDoseCount(c)
  if (getDosesLeft(item) < doses) return `needs ${doses} doses`
  return consume.with && !getAppliedWith(c, item) ? `needs ${consume.with}` : null
}

// gear.tex "Potions and Medicine": the potions in hand a dose can be taken of
// now, and why none can when none can.
export function getTakeableHeld(c: Character): { takeable: Item[]; bar: string | null } {
  const held = getHeldConsumables(c)
  const bars = held.map((item) => getConsumeBar(c, item))
  const takeable = held.filter((_, i) => bars[i] === null)
  return { takeable, bar: held.length === 0 ? 'no potion in hand' : takeable.length === 0 ? bars[0] : null }
}
