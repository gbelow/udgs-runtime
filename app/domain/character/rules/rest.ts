import type { CampaignCharacter, Character } from '../../types'
import { ROUND_AP } from '../../tables'
import { getActionCost } from './actionCosts'
import { hasAffliction } from './afflictions'

// combat.tex "Suffocation": a character who cannot breathe "cannot Rest".
export function mayRest(c: Character): boolean {
  return !hasAffliction(c, 'suffocating')
}

// combat.tex "Rest": resting "can make AP negative, as long as it starts
// next round positive" — and the round starts at ROUND_AP less what is owed
// ("End of the round").
export function canAffordRest(c: CampaignCharacter): boolean {
  return c.resources.AP - getActionCost(c, 'rest').AP + ROUND_AP > 0
}
