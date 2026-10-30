import type { BoardMap, SceneState } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { getBoardView, type BoardView } from './boardView'

// The board as it would be kept under `name`, or nothing while the fight has
// no grid.
export function getBoardMap(state: SceneState, name: string): BoardMap | null {
  return state.board ? makeBoardMap({ ...state.board, name }) : null
}

// The map drawn as the fight's board is, for the editor that paints it. At a
// storey (`level`), the cells it lays a floor in are drawn as that floor and
// the rest as the ground seen through a stairwell or open air.
export function getBoardMapView(map: BoardMap, level: number | null = null): BoardView {
  const storey = level === null ? undefined : map.levels[level]
  if (!storey) return getBoardView({ ...sceneOfMap(map), activeCharacterId: null })
  const floors = Object.entries(storey.terrain).filter(([, cell]) => !cell.hole)
  const seen = { ...map, levels: [], terrain: { ...map.terrain, ...Object.fromEntries(floors.map(([key, cell]) => [key, { ...cell, elevation: storey.floor }])) } }
  const view = getBoardView({ ...sceneOfMap(seen), activeCharacterId: null })
  return { ...view, cells: view.cells.map((c) => ({ ...c, storey: storey.terrain[c.key] ? (storey.terrain[c.key].hole ? 'hole' : 'floor') : 'air' })) }
}

// The storeys the editor paints on: the ground, then each of the map's own
// storeys by its place in `levels`, named for its floor.
export type StoreyRow = { level: number | null; label: string; floor: number; height: number }

export function getStoreyRows(map: BoardMap): StoreyRow[] {
  const own = map.levels.flatMap((level, i) => (level.piece === null ? [{ level: i, floor: level.floor, height: level.height }] : []))
  return [
    { level: null, label: 'ground', floor: 0, height: 0 },
    ...own.map((row, n) => ({ ...row, label: `storey ${n + 1} · ${row.floor} m` })),
  ]
}
