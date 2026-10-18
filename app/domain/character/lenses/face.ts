import { CampaignCharacterSchema, type CampaignCharacter } from '../../types'

// multiplayer-plan.md "Hidden information": what a viewer is shown of a
// character they see but do not play — the token: who it is, how big, what it
// wears and holds in the open and where it is wounded. The rest of the sheet
// reads as an empty one, so what is worked out against it is an estimate.
type Face = Pick<CampaignCharacter, 'id' | 'name' | 'size' | 'footprint' | 'height' | 'armor' | 'body' | 'stance' | 'hasGauntlets' | 'hasHelm' | 'visorOpen' | 'worn' | 'held' | 'onBack'>
const FACE_KEYS: (keyof Face)[] = ['id', 'name', 'size', 'footprint', 'height', 'armor', 'body', 'stance', 'hasGauntlets', 'hasHelm', 'visorOpen', 'worn', 'held', 'onBack']

const blank = CampaignCharacterSchema.parse({})
const faces = new WeakMap<CampaignCharacter, CampaignCharacter>()

// The same face for the same sheet, so that a view built again from an
// unchanged sheet is the same object.
export function getPublicFace(character: CampaignCharacter): CampaignCharacter {
  let face = faces.get(character)
  if (!face) {
    face = { ...blank, ...Object.fromEntries(FACE_KEYS.map((k) => [k, character[k]])) }
    faces.set(character, face)
  }
  return face
}
