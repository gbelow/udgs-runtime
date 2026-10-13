import type { CampaignCharacter } from '../../types'
import { ROUND_AP } from '../../tables'
import { getActionCost } from './actionCosts'

// combat.tex "Rest": resting "can make AP negative, as long as it starts
// next round positive" — and the round starts at ROUND_AP less what is owed
// ("End of the round"). combat.tex "Social actions": each "counts as a Rest
// action". `incoming` is the AP still to come before the next round starts:
// none once the round change has handed them out.
export function canAffordRest(c: CampaignCharacter, kind: 'rest' | 'socialAction' = 'rest', incoming: number = ROUND_AP): boolean {
  return c.resources.AP - getActionCost(c, kind).AP + incoming > 0
}
