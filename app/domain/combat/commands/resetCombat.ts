import { CombatState } from '../types'

// clear all characters from combat and reset round counter
export function resetCombat(state: CombatState): CombatState {
  return ({
    ...state,
    characters: {},
    round: 0,
    board: state.board ? { ...state.board, placements: {} } : null,
  })
}
