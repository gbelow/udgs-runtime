import type { CampaignState } from '../types'

// The name the character goes by on the roster, which tells copies of one
// sheet apart.
export function getRosterName(state: CampaignState, id: string): string {
  return state.characters[id]?.fightName ?? state.characters[id]?.name ?? id
}
