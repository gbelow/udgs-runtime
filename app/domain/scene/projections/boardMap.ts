import type { BoardMap, SceneState } from '../types'
import { makeBoardMap } from '../factories'

// The board as it would be kept under `name`, or nothing while the fight has
// no grid.
export function getBoardMap(state: SceneState, name: string): BoardMap | null {
  return state.board ? makeBoardMap({ ...state.board, name }) : null
}
