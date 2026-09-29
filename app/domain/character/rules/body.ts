import type { BodyPart, Character } from '../../types'
import { isPartWounded } from './wounds'

// The parts there to be used: not cut off, and not put out of use by a wound
// (combat.tex "Wounds").
export function getWorkingParts(c: Character): BodyPart[] {
  return c.body.filter((part) => !part.lost && !isPartWounded(c, part.id))
}
