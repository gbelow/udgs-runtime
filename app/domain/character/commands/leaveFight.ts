import type { CampaignCharacter } from '../../types'
import { bleed } from './bleed'
import { burnScorch, extinguish } from './deliver'
import { isDead } from '../rules/afflictions'
import { getSTA } from '../rules/characteristics'

// What the end of a fight or a chase does to each character: the fire
// touched this turn burns, then combat.tex "Burning": "At the end of combat, burning damage is
// caused once and the counter is set to 0"; combat.tex "Bleed": "When
// combat/chase ends, bleeding causes 3x its current value and stops by
// itself"; what lasts for the rest of the fight — a light cast — is gone,
// and so is what the round held, a bleed staunched by First Aid among it;
// STA is back to full, though one already above it keeps what it has.
export function leaveFight(c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const bled = bleed(3)(extinguish(burnScorch({ ...c, injuries: { ...c.injuries, staunched: false } })))
  return {
    ...bled,
    injuries: { ...bled.injuries, bleed: 0 },
    active: bled.active.filter((e) => e.kind !== 'light'),
    resources: { ...bled.resources, AP: 0, STA: Math.max(bled.resources.STA, getSTA(bled)) },
    usedSurge: null,
    surgeFloor: null,
    runsFree: false,
  }
}
