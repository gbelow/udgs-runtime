import type { CampaignCharacter } from '../../types'
import type { CombatState } from '../types'

// Read-side: which character is active is a pure function of combat state.
// The store previously owned this as a method, which is what forced the combat
// commands to import CombatStore — the inverted dependency. The store now
// delegates here, so there is exactly one definition and the domain owns it.
export function getActiveCharacter(state: CombatState): CampaignCharacter | null {
  if (!state.activeCharacterId) return null
  return state.characters[state.activeCharacterId] ?? null
}
