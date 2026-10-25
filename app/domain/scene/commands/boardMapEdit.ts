import type { TerrainBrush } from '../../types'
import { BoardMapSchema, type BoardMap, type Coord, type LightLevel } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { paintTerrain, resizeBoard } from './board'

// A kept board edited as the fight's board is, with the same brushes: the map
// stands in a fight of nobody and the fight's own commands change it.

export type BoardMapUpdater = (map: BoardMap) => BoardMap

// A fresh map of the given radius, all open ground.
export function newBoardMap(radius = 6): BoardMap {
  return BoardMapSchema.parse({ radius })
}

function viaScene(map: BoardMap, change: (scene: ReturnType<typeof sceneOfMap>) => ReturnType<typeof sceneOfMap>): BoardMap {
  const board = change(sceneOfMap(map)).board
  return board ? makeBoardMap({ ...board, name: map.name }) : map
}

export function renameBoardMap(name: string): BoardMapUpdater {
  return (map) => ({ ...map, name })
}

export function paintBoardMap(cell: Coord, brush: TerrainBrush): BoardMapUpdater {
  return (map) => viaScene(map, paintTerrain(cell, brush))
}

export function lightBoardMap(light: LightLevel): BoardMapUpdater {
  return (map) => ({ ...map, light })
}

// Widens or narrows the field; what lay beyond the new edge is dropped.
export function resizeBoardMap(radius: number): BoardMapUpdater {
  return (map) => viaScene(map, resizeBoard(radius))
}
