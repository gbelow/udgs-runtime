import type { AfflictionKey, BodyPart, Character, HitLocation, Item, PartFlag, PartWound } from '../../types'
import { ItemSchema } from '../../types'
import { PART_PRESETS } from '../../tables'
import { isPartWounded } from './wounds'

// combat.tex "Localized damage": a place a blow is aimed at or lands on —
// the part, with what aiming there costs, the cap on the tier the body takes,
// what the part does and the wounds it takes. With no part of the kind left
// the place is the kind as the humanoid's row describes it, with nothing
// there to wound.
export type Place = { part: BodyPart | null; aimPenalty: number; maxTier: number | null; flags: readonly PartFlag[]; wounds: readonly PartWound[] }

export function getPlace(part: BodyPart | null, location: HitLocation): Place {
  if (part) return { part, aimPenalty: part.aimPenalty, maxTier: part.maxTier, flags: part.flags, wounds: part.wounds }
  const { aimPenalty, maxTier, flags } = PART_PRESETS[location]
  return { part: null, aimPenalty, maxTier, flags, wounds: [] }
}

// The part an aim names: the one it picked while still there, else the
// first of the kind still there.
export function getAimedPart(target: Character | undefined, aim: { location: HitLocation; part: string | null }): BodyPart | null {
  const there = target?.body.filter((part) => part.location === aim.location && !part.lost) ?? []
  return there.find((part) => part.id === aim.part) ?? there[0] ?? null
}

export function getAimedPlace(target: Character | undefined, aim: { location: HitLocation; part: string | null }): Place {
  return getPlace(getAimedPart(target, aim), aim.location)
}

// The parts there to be used: not cut off, and not put out of use by a wound
// (combat.tex "Wounds").
export function getWorkingParts(c: Character): BodyPart[] {
  return c.body.filter((part) => !part.lost && !isPartWounded(c, part.id))
}

// combat.tex "Climbing": whether the part takes hold of a surface — a hand
// unless its body says otherwise, or whatever the body flags.
export function canClimbWith(part: BodyPart): boolean {
  return part.climbs ?? part.location === 'hand'
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
// puts it back gets the part it was, and marked with whose it was, since
// only they can take it back; `whose` is the name they go by.
export function getSeveredItem(part: BodyPart, id: string, ownerId: string, whose: string): Item {
  return ItemSchema.parse({ id, name: whose ? `${whose}'s ${part.name}` : part.name, part: { ...part, itemId: '', lost: false }, severedFrom: ownerId })
}
