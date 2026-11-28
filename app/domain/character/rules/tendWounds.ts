import type { CampaignCharacter, Degree } from '../../types'
import type { Test } from '../../play/test'
import { getHealthTerms } from './skills'
import { sumTerms, type Term } from './terms'

// combat.tex "Tend Wounds": "a health test vs bleed value", the character's
// own, with whatever else is added to it (`added`).
export function getTendWoundsTest(c: CampaignCharacter, added: Term[] = []): Test & { terms: NonNullable<Test['terms']> } {
  const skill = [...getHealthTerms(c), ...added]
  const DL = [{ label: 'bleed', value: c.injuries.bleed }]
  return { skill: sumTerms(skill), DL: c.injuries.bleed, explodes: false, scale: 'degrees', terms: { skill, DL } }
}

// combat.tex "Tend Wounds": "stops 0/1/2/3 bleed"; abilities.tex "First Aid":
// "Reduces bleeding by 0/1/2/3".
export const BLEED_STOPPED: Record<Degree, number> = { miss: 0, graze: 1, hit: 2, critical: 3 }
