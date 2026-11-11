import type { CampaignCharacter } from '../../types'
import { getHealth } from './skills'
import { hasGrant } from './effects'
import { isDead } from './afflictions'
import { getKnowledge } from './knowledge'
import { ADAPTIVE_RESTS_PER_DAY, REST_RECOVERY, RESERVOIR_CAPACITY, RESTS_PER_DAY, TIRELESS_REST_RECOVERY } from '../../tables'

// survival.tex "Rest": "heals IL equal to 1+(health-exposure)/2. Negative
// values work against the character." `bonus` is health the ET gives on top
// (spells.tex "Enhanced Sleep"); abilities.tex "Metabolic Control": "Adds
// Biomancy to health when resting."
export function getRestHealing(c: CampaignCharacter, exposure: number, bonus = 0): number {
  const metabolism = hasGrant(c, 'metabolicControl') ? getKnowledge('biomancy')(c) : 0
  return 1 + Math.floor((getHealth(c) + metabolism + bonus - exposure) / 2)
}

// survival.tex "Rest": "lowers exhaustion by 3 - exposure/2 instead of
// increasing it"; abilities.tex "Tireless" raises the 3 to 4.
export function getRestRecovery(c: CampaignCharacter, exposure: number): number {
  return (hasGrant(c, 'tireless') ? TIRELESS_REST_RECOVERY : REST_RECOVERY) - Math.floor(exposure / 2)
}

// survival.tex "Rest": how many rests a day heal; abilities.tex "Adaptive
// Sleep" learns to rest 6 ETs a day effectively.
export function getRestsPerDay(c: CampaignCharacter): number {
  return hasGrant(c, 'adaptiveSleep') ? ADAPTIVE_RESTS_PER_DAY : RESTS_PER_DAY
}

// abilities.tex "Resurrection": "The body rests after the character dies."
export function isResurrecting(c: CampaignCharacter): boolean {
  return isDead(c) && hasGrant(c, 'resurrection')
}

// survival.tex "Long Camping": "Every day, characters heal
// 3+3*(health-exposure)/2"; negative values work against them, as a rest's do.
export function getLongCampHealing(c: CampaignCharacter, exposure: number): number {
  return 3 + Math.floor((3 * (getHealth(c) - exposure)) / 2)
}

// abilities.tex "Regenerative Reservoir": how much healing the character can
// keep stored; none without the ability.
export function getReservoirCapacity(c: CampaignCharacter): number {
  return hasGrant(c, 'regenerativeReservoir') ? RESERVOIR_CAPACITY : 0
}
