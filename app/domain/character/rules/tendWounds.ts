import type { CampaignCharacter } from '../../types'
import type { Test } from '../../play/test'
import { getHealthTerms } from './skills'
import { sumTerms } from './terms'

// combat.tex "Tend Wounds": "a health test vs bleed value", the character's
// own.
export function getTendWoundsTest(c: CampaignCharacter): Test & { terms: NonNullable<Test['terms']> } {
  const skill = getHealthTerms(c)
  const DL = [{ label: 'bleed', value: c.injuries.bleed }]
  return { skill: sumTerms(skill), DL: c.injuries.bleed, explodes: false, scale: 'degrees', terms: { skill, DL } }
}
