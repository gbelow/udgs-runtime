import type { TerrainBrush } from '../../types'
import { BoardMapSchema, StructureArtSchema, type BoardExtent, type BoardMap, type Coord, type GroundRecipe, type LightLevel, type Structure, type StructureArt, type SurfaceTarget, type Updater } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { addLevel, editPiece, generateGround, laySurface, movePiece, paintTerrain, placePiece, removeLevel, removePiece, resizeBoard, setLevel, setSurface, turnPiece } from './board'
import { getPieceLevel } from '../rules/board/piece'

// A kept board edited as the fight's board is, with the same brushes: the map
// stands in a fight of nobody and the fight's own commands change it.

export type BoardMapUpdater = (map: BoardMap) => BoardMap

// A fresh map reaching `radius` along every axis, all open ground.
export function newBoardMap(radius = 6): BoardMap {
  return BoardMapSchema.parse({ extent: { q: radius, r: radius, s: radius } })
}

function viaScene(map: BoardMap, change: (scene: ReturnType<typeof sceneOfMap>) => ReturnType<typeof sceneOfMap>): BoardMap {
  const board = change(sceneOfMap(map)).board
  return board ? makeBoardMap({ ...board, name: map.name, art: map.art }) : map
}

export function renameBoardMap(name: string): BoardMapUpdater {
  return (map) => ({ ...map, name })
}

// The picture of the structure being edited: none, or the picture it has (a
// fresh one if it had none) with these fields changed.
export function artBoardMap(change: Partial<StructureArt> | null): BoardMapUpdater {
  return (map) => ({ ...map, art: change === null ? null : StructureArtSchema.parse({ ...map.art, ...change }) })
}

// A change to the map's own ground and storeys, or with a `piece` picked, to
// that piece: `level` is the map's storey painted on, which with a piece must
// be one of the piece's, and is handed to the change as its place among them.
function onOwner(piece: string | null, level: number | null, change: (level: number | null) => Updater): BoardMapUpdater {
  return (map) => {
    if (piece === null) return viaScene(map, change(level))
    const own = getPieceLevel(map, piece, level)
    return level !== null && own === null ? map : viaScene(map, editPiece(piece, change(own)))
  }
}

export function paintBoardMap(cell: Coord, brush: TerrainBrush, radius = 0, level: number | null = null, piece: string | null = null): BoardMapUpdater {
  return onOwner(piece, level, (at) => paintTerrain(cell, brush, radius, at))
}

export function addLevelBoardMap(piece: string | null = null): BoardMapUpdater {
  return onOwner(piece, null, () => addLevel())
}

export function removeLevelBoardMap(level: number, piece: string | null = null): BoardMapUpdater {
  return onOwner(piece, level, (at) => (at === null ? (s) => s : removeLevel(at)))
}

export function setLevelBoardMap(level: number, change: { floor?: number, height?: number }, piece: string | null = null): BoardMapUpdater {
  return onOwner(piece, level, (at) => (at === null ? (s) => s : setLevel(at, change)))
}

export function placePieceBoardMap(id: string, structure: Structure, cell: Coord, rotation: number): BoardMapUpdater {
  return (map) => viaScene(map, placePiece(id, structure, cell, rotation))
}

export function movePieceBoardMap(id: string, cell: Coord): BoardMapUpdater {
  return (map) => viaScene(map, movePiece(id, cell))
}

export function turnPieceBoardMap(id: string, steps: number): BoardMapUpdater {
  return (map) => viaScene(map, turnPiece(id, steps))
}

export function removePieceBoardMap(id: string): BoardMapUpdater {
  return (map) => viaScene(map, removePiece(id))
}

export function surfaceBoardMap(surface: string | null): BoardMapUpdater {
  return (map) => viaScene(map, setSurface(surface))
}

export function laySurfaceBoardMap(cell: Coord, name: string, roll: number, frozen: string | null, radius = 0, level: number | null = null, piece: string | null = null, onto: SurfaceTarget = 'ground'): BoardMapUpdater {
  return onOwner(piece, level, (at) => laySurface(cell, name, roll, frozen, radius, at, onto))
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
