import { CampaignCharacterSchema, type CampaignCharacter, type Third } from '../../types'
import { ROUND_AP } from '../../tables'
import { getSTA } from '../rules/characteristics'

// multiplayer-plan.md "Hidden information": what a viewer is shown of a
// character they see but do not play — the token: who it is, how big, what it
// wears and holds in the open and where it is wounded. The table's ruling:
// how hurt it is (its injury level) shows too, and of its AP and its STA only
// which third of a round's AP and of its STA is left (`shown`), never the
// numbers. The rest of the sheet reads as an empty one, so what is worked out
// against it is an estimate.
type Face = Pick<CampaignCharacter, 'id' | 'name' | 'token' | 'size' | 'footprint' | 'height' | 'armor' | 'body' | 'stance' | 'hasGauntlets' | 'hasHelm' | 'visorOpen' | 'worn' | 'held' | 'onBack'>
export const FACE_KEYS: (keyof Face)[] = ['id', 'name', 'token', 'size', 'footprint', 'height', 'armor', 'body', 'stance', 'hasGauntlets', 'hasHelm', 'visorOpen', 'worn', 'held', 'onBack']

const blank = CampaignCharacterSchema.parse({})
const faces = new WeakMap<CampaignCharacter, CampaignCharacter>()

function thirdOf(value: number, most: number): Third {
  if (most <= 0 || 3 * value > 2 * most) return 2
  return 3 * value > most ? 1 : 0
}

// The most the third could hold, of `most`.
export function fillThird(third: Third, most: number): number {
  return Math.floor((most * (third + 1)) / 3)
}

// The same face for the same sheet, so that a view built again from an
// unchanged sheet is the same object.
export function getPublicFace(character: CampaignCharacter): CampaignCharacter {
  let face = faces.get(character)
  if (!face) {
    face = {
      ...blank,
      ...Object.fromEntries(FACE_KEYS.map((k) => [k, character[k]])),
      injuries: { ...blank.injuries, injuryLevel: character.injuries.injuryLevel },
      shown: { AP: thirdOf(character.resources.AP, ROUND_AP), STA: thirdOf(character.resources.STA, getSTA(character)) },
    }
    faces.set(character, face)
  }
  return face
}
