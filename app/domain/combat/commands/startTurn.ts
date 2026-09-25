import type { CombatState } from '../types'
import { getActiveCharacter } from '../rules/activeCharacter'

// The active character's turn begins.
export function startTurn(state: CombatState): CombatState {
  return { ...state, inTurnCharacter: getActiveCharacter(state)?.id ?? '' }
}
