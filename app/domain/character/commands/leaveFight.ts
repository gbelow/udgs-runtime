import type { CampaignCharacter } from '../../types'
import { bleed } from './bleed'
import { burnScorch, extinguish } from './deliver'
import { isDead } from '../rules/afflictions'

// What the end of a fight or a chase does to each character: the fire
// touched this turn burns, then combat.tex "Burning": "At the end of combat, burning damage is
// caused once and the counter is set to 0"; combat.tex "Bleed": "When
// combat/chase ends, bleeding causes 3x its current value and stops by
// itself"; what lasts for the rest of the fight — a potion drunk, a light
// cast — is gone, and so is what the round held.
export function leaveFight(c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const bled = bleed(3)(extinguish(burnScorch(c)))
  return {
    ...bled,
    injuries: { ...bled.injuries, bleed: 0 },
    active: bled.active.filter((e) => e.kind !== 'potion' && e.kind !== 'light'),
    resources: { ...bled.resources, AP: 0, surgeAP: 0 },
    usedSurge: null,
    runsFree: false,
  }
}
