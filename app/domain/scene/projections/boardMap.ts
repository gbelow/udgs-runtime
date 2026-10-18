import type { BoardMap, SceneState } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { getBoardView, type BoardView } from './boardView'

// The board as it would be kept under `name`, or nothing while the fight has
// no grid.
export function getBoardMap(state: SceneState, name: string): BoardMap | null {
  return state.board ? makeBoardMap({ ...state.board, name }) : null
}

// The map drawn as the fight's board is, for the editor that paints it.
export function getBoardMapView(map: BoardMap): BoardView {
  return getBoardView({ ...sceneOfMap(map), activeCharacterId: null })
}
