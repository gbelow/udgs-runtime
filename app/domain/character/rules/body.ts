import type { AfflictionKey, BodyPart, Character, Item } from '../../types'
import { ItemSchema } from '../../types'
import { isPartWounded } from './wounds'

// The parts there to be used: not cut off, and not put out of use by a wound
// (combat.tex "Wounds").
export function getWorkingParts(c: Character): BodyPart[] {
  return c.body.filter((part) => !part.lost && !isPartWounded(c, part.id))
}

// The legs the creature is short of: cut off or broken, the one as bad as
// the other.
export function getLegsShort(c: Character): number {
  const working = new Set(getWorkingParts(c).map((part) => part.id))
  return c.body.filter((part) => part.location === 'leg' && !working.has(part.id)).length
}

// What the legs it is short of do to it, by what its stance authors: lame
// from so many, down for good from so many more.
export function getStanceAfflictions(c: Character): AfflictionKey[] {
  const short = getLegsShort(c)
  if (short === 0) return []
  return [
    ...(short >= c.stance.lameAt ? ['lame' as const] : []),
    ...(short >= c.stance.proneAt ? ['prone' as const] : []),
  ]
}

export function canStand(c: Character): boolean {
  return getLegsShort(c) < c.stance.proneAt
}

// A part cut off, as the thing it becomes: whole, holding nothing, so what
// puts it back gets the part it was.
export function getSeveredItem(part: BodyPart, id: string): Item {
  return ItemSchema.parse({ id, name: part.name, part: { ...part, itemId: '', lost: false } })
}
