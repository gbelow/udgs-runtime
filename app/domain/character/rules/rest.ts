import type { CampaignCharacter } from '../../types'
import { ROUND_AP } from '../../tables'
import { getActionCost } from './actionCosts'

// combat.tex "Rest": resting "can make AP negative, as long as it starts
// next round positive" — and the round starts at ROUND_AP less what is owed
// ("End of the round"). combat.tex "Social actions": each "counts as a Rest
// action".
export function canAffordRest(c: CampaignCharacter, kind: 'rest' | 'socialAction' = 'rest'): boolean {
  return c.resources.AP - getActionCost(c, kind).AP + ROUND_AP > 0
}
