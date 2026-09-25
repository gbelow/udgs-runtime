import type { CampaignCharacter } from '../../types'
import type { CombatState } from '../types'

// Read-side: which character is active is a pure function of combat state.
// The domain owns this so combat commands never need to import CombatStore.
export function getActiveCharacter(state: CombatState): CampaignCharacter | null {
  if (!state.activeCharacterId) return null
  return state.characters[state.activeCharacterId] ?? null
}

// The name a character goes by in the fight, which tells copies of one sheet
// apart; empty for anyone not in it.
export function getFightName(state: CombatState, id: string): string {
  return state.characters[id]?.fightName ?? ''
}
