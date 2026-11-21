import type { CampaignCharacter, Degree } from '../../types'
import { bleed } from './bleed'
import { burnScorch, extinguish } from './deliver'
import { isDead } from '../rules/afflictions'
import { getSTA } from '../rules/characteristics'

// combat.tex "Bleed": "When combat/chase ends, make a tend wounds test. Take
// IL damage equal to 10/6/4/2x of the bleed value and stop bleeding", by
// the test's degree. A bleed staunched by First Aid was staunched for its
// round only.
const BLED_AFTER_FIGHT: Record<Degree, number> = { miss: 10, graze: 6, hit: 4, critical: 2 }

export function tendAfterFight(degree: Degree): (c: CampaignCharacter) => CampaignCharacter {
  return (c) => {
    const bled = bleed(BLED_AFTER_FIGHT[degree])({ ...c, injuries: { ...c.injuries, staunched: false } })
    return { ...bled, injuries: { ...bled.injuries, bleed: 0 } }
  }
}

// What the end of a fight or a chase does to each character: the fire
// touched this turn burns, then combat.tex "Burning": "At the end of combat, burning damage is
// caused once and the counter is set to 0"; the bleeding stops, whatever the
// tend wounds test made of it (`tendAfterFight`), or with none made where the
// table takes a character out by hand; what lasts for the rest of the fight
// (a light cast) is gone, and so is what the round held, a bleed staunched by
// First Aid among it; STA is back to full, though one already above it keeps
// what it has.
export function leaveFight(c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const bled = extinguish(burnScorch({ ...c, injuries: { ...c.injuries, staunched: false } }))
  return {
    ...bled,
    injuries: { ...bled.injuries, bleed: 0 },
    active: bled.active.filter((e) => e.kind !== 'light'),
    resources: { ...bled.resources, AP: 0, STA: Math.max(bled.resources.STA, getSTA(bled)) },
    usedSurge: null,
    surgeFloor: null,
    runsFree: false,
    rallied: false,
    steeled: false,
  }
}
