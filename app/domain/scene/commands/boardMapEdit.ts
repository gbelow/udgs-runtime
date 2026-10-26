import type { TerrainBrush } from '../../types'
import { BoardMapSchema, type BoardExtent, type BoardMap, type Coord, type GroundRecipe, type LightLevel } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { generateGround, laySurface, paintTerrain, resizeBoard, setSurface } from './board'

// A kept board edited as the fight's board is, with the same brushes: the map
// stands in a fight of nobody and the fight's own commands change it.

export type BoardMapUpdater = (map: BoardMap) => BoardMap

// A fresh map reaching `radius` along every axis, all open ground.
export function newBoardMap(radius = 6): BoardMap {
  return BoardMapSchema.parse({ extent: { q: radius, r: radius, s: radius } })
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

export function surfaceBoardMap(surface: string | null): BoardMapUpdater {
  return (map) => viaScene(map, setSurface(surface))
}

export function laySurfaceBoardMap(cell: Coord, name: string, roll: number, frozen: string | null): BoardMapUpdater {
  return (map) => viaScene(map, laySurface(cell, name, roll, frozen))
}

export function generateGroundBoardMap(recipe: GroundRecipe, seed: number): BoardMapUpdater {
  return (map) => viaScene(map, generateGround(recipe, seed))
}

export function lightBoardMap(light: LightLevel): BoardMapUpdater {
  return (map) => ({ ...map, light })
}

// Widens or narrows the field; what lay beyond the new edge is dropped.
export function resizeBoardMap(extent: BoardExtent): BoardMapUpdater {
  return (map) => viaScene(map, resizeBoard(extent))
}
