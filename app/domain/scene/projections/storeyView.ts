import type { Board, SeenScene } from '../types'
import { FALL } from '../../tables'
import { getTerrainAt } from '../rules/board/board'
import { getBoardView, type BoardCellView, type BoardView } from './boardView'

// The board looked at from a height: each cell drawn as the floor someone
// whose feet are there stands on (`getTerrainAt`), the cells where they would
// fall veiled as open air over the ground, and whoever stands on another
// floor drawn apart. What the board offers and what a click means are the
// same at every height; only the drawing changes.

export type StoreyChoice = { height: number | null; label: string }

// The ground, and each floor a storey of the board is laid at, lowest first.
export function getStoreyChoices(board: Board | null): StoreyChoice[] {
  const floors = [...new Set((board?.levels ?? []).map((level) => level.floor))].sort((a, b) => a - b)
  return [{ height: null, label: 'ground' }, ...floors.map((floor) => ({ height: floor, label: `${floor} m` }))]
}

// The height picked, or with 'auto' the floor the active character stands
// on when it is a storey's; null for the ground.
export function getViewHeight(state: SeenScene, picked: number | null | 'auto'): number | null {
  if (picked !== 'auto') return picked
  const board = state.board
  const placement = state.activeCharacterId ? board?.placements[state.activeCharacterId] : undefined
  if (!board || !placement) return null
  const footing = getTerrainAt(board, placement.cell, placement.elevation)
  return footing.level === null ? null : footing.floor
}

// What the cell looks like is the drawn floor's; what it offers is the view's.
const DRAWN: (keyof BoardCellView)[] = ['terrain', 'strength', 'elevation', 'elevationLabel', 'fire', 'fuels', 'suffocating', 'visibility', 'noise', 'surface', 'art', 'bledInto']

const cache = new WeakMap<BoardView, Map<number, BoardView>>()

export function getStoreyView(state: SeenScene, view: BoardView, height: number | null): BoardView {
  const board = state.board
  if (height === null || !board || !view.present) return view
  const known = cache.get(view)?.get(height)
  if (known) return known
  const footing = (cell: BoardCellView['cell']) => getTerrainAt(board, cell, height)
  const terrain = { ...board.terrain }
  for (const c of view.cells) {
    const f = footing(c.cell)
    if (f.level !== null && f.terrain) terrain[c.key] = { ...f.terrain, elevation: f.floor }
  }
  const drawn = getBoardView({ ...state, board: { ...board, terrain, levels: [] } })
  const byKey = new Map(drawn.cells.map((c) => [c.key, c]))
  const cells = view.cells.map((c): BoardCellView => {
    const d = byKey.get(c.key)
    const f = footing(c.cell)
    const hole = board.levels.some((level) => Math.abs(level.floor - height) < FALL.minHeight && level.terrain[c.key]?.hole)
    const storey = f.level !== null ? 'floor' : hole ? 'hole' : height - f.floor >= FALL.minHeight ? 'air' : null
    return { ...c, ...(d ? Object.fromEntries(DRAWN.map((k) => [k, d[k]])) : {}), storey }
  })
  const tokens = view.tokens.map((t) => {
    const placement = board.placements[t.id]
    const elsewhere = !!placement && Math.abs(getTerrainAt(board, placement.cell, placement.elevation).floor - footing(placement.cell).floor) >= FALL.minHeight
    return { ...t, elsewhere }
  })
  const seen = { ...view, cells, tokens, arts: drawn.arts, ridges: drawn.ridges, faces: drawn.faces, bands: drawn.bands }
  cache.set(view, (cache.get(view) ?? new Map()).set(height, seen))
  return seen
}
