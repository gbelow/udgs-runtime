import type { CampaignCharacter } from '../../types'
import { getHealth } from './skills'

// survival.tex "Rest": "heals IL equal to 1+(health-exposure)/2. Negative
// values work against the character."
export function getRestHealing(c: CampaignCharacter, exposure: number): number {
  return 1 + Math.floor((getHealth(c) - exposure) / 2)
}

// survival.tex "Rest": "lowers exhaustion by 3 - exposure/2 instead of
// increasing it".
export function getRestRecovery(exposure: number): number {
  return 3 - Math.floor(exposure / 2)
}

// survival.tex "Long Camping": "Every day, characters heal
// 3+3*(health-exposure)/2"; negative values work against them, as a rest's do.
export function getLongCampHealing(c: CampaignCharacter, exposure: number): number {
  return 3 + Math.floor((3 * (getHealth(c) - exposure)) / 2)
}
