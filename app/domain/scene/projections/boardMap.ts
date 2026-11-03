import type { BoardMap, SceneState } from '../types'
import { makeBoardMap, sceneOfMap } from '../factories'
import { getBoardView, getStandingOf, type BoardView } from './boardView'
import { coordKey } from '../rules/board/geometry'
import { getPieceAt } from '../rules/board/piece'
import { getCellLighting } from '../rules/board/light'
import { getStoreyFloor } from '../rules/board/board'
import { WINDOW_LIGHT } from '../../tables'

// The board as it would be kept under `name`, or nothing while the fight has
// no grid.
export function getBoardMap(state: SceneState, name: string): BoardMap | null {
  return state.board ? makeBoardMap({ ...state.board, name }) : null
}

// The map drawn as the fight's board is, for the editor that paints it. At a
// storey (`level`), the cells it lays a floor in are drawn as that floor and
// the rest as the ground seen through a stairwell or open air. Each floor is
// lit as it would be in a fight, under the storeys over it; a structure
// (`open`) stands in the open, so the ground past the map's edge is lit under
// the sky and shines in through its windows and doorways. The cells of the
// piece `chosen` are marked.
export function getBoardMapView(map: BoardMap, level: number | null = null, chosen: string | null = null, open = false): BoardView {
  const storey = level === null ? undefined : map.levels[level]
  const floors = Object.entries(storey?.terrain ?? {}).filter(([, cell]) => !cell.hole)
  const seen = storey ? { ...map, levels: [], terrain: { ...map.terrain, ...Object.fromEntries(floors.map(([key, cell]) => [key, { ...cell, elevation: storey.floor + cell.elevation }])) } } : map
  const view = getBoardView({ ...sceneOfMap(seen), activeCharacterId: null })
  const beyond = open ? WINDOW_LIGHT.fading : 0
  const lighting = sceneOfMap({ ...map, extent: { q: map.extent.q + beyond, r: map.extent.r + beyond, s: map.extent.s + beyond } })
  // the picture of the structure being edited stands on the map's anchor
  const own = getStandingOf('structure', map.art, view.cells.find((c) => c.key === coordKey(map.origin)), 0, Math.max(0, ...Object.values(map.terrain).filter((cell) => cell.piece === null).map((cell) => cell.elevation)), map.levels.filter((l) => l.piece === null).map((l) => l.floor))
  const standing = [...view.standing, ...own]
  const cells = view.ground.cells.map((c) => ({
    ...c,
    piece: getPieceAt(map, c.key),
    storey: !storey ? null : storey.terrain[c.key] ? (storey.terrain[c.key].hole ? 'hole' as const : storey.terrain[c.key].lattice ? 'lattice' as const : 'floor' as const) : 'air' as const,
  }))
  const drawn = new Map(cells.map((c) => [c.key, c]))
  return {
    ...view,
    ground: { ...view.ground, cells, standing },
    standing,
    cells: view.cells.map((c) => {
      const ground = drawn.get(c.key)!
      const floor = storey?.terrain[c.key]
      const { light, lit } = getCellLighting(lighting, c.cell, storey && floor && !floor.hole ? getStoreyFloor(storey, floor) : undefined)
      return { ...c, ...ground, light, lit, chosen: ground.piece !== null && ground.piece === chosen }
    }),
  }
}

// The storeys the editor paints on: the ground, then each storey of the map's
// own, or of the piece picked (`owner`), by its place in `levels`, named for
// its floor. A piece's floors are measured from the ground it was laid on.
export type StoreyRow = { level: number | null; label: string; floor: number; height: number }

export function getStoreyRows(map: BoardMap, owner: string | null = null): StoreyRow[] {
  const base = owner === null ? 0 : map.pieces[owner]?.elevation ?? 0
  const own = map.levels.flatMap((level, i) => (level.piece === owner ? [{ level: i, floor: level.floor - base, height: level.height }] : []))
  return [
    { level: null, label: 'ground', floor: 0, height: 0 },
    ...own.map((row, n) => ({ ...row, label: `storey ${n + 1} · ${row.floor} m` })),
  ]
}

// The pieces laid on the map, for the editor to pick from.
export type PieceRow = { id: string; name: string }

export function getPieceRows(map: BoardMap): PieceRow[] {
  return Object.entries(map.pieces).map(([id, piece]) => ({ id, name: piece.name || 'a structure' })).sort((a, b) => a.name.localeCompare(b.name))
}
