import type { CombatState } from '../types'

// Empties the fight: nobody in it, nothing on the floor or in the action log,
// back to round 0. The board's ground is kept; only who stands on it goes.
export function resetCombat(state: CombatState): CombatState {
  return {
    ...state,
    characters: {},
    activeCharacterId: null,
    inTurnCharacter: '',
    round: 0,
    actions: [],
    stack: [],
    board: state.board ? { ...state.board, placements: {} } : null,
    grapples: [],
    floor: [],
  }
}
