import type { Board, Coord, SeenScene } from '../types'
import { FALL } from '../../tables'
import { coordKey, disk } from '../rules/board/geometry'
import { getFloors, getRoofs, getTerrainAt, type Footing } from '../rules/board/board'
import { getCellSenser } from '../rules/detection'
import { getCellLighting } from '../rules/board/light'
import { getFloorArt } from '../rules/board/surface'
import { getBoardView, type BoardCellView, type BoardOverheadView, type BoardView } from './boardView'

// The board looked at from a height: each cell drawn as the floor someone
// whose feet are there stands on (`getTerrainAt`), the cells where they would
// fall veiled as open air over the ground, and whoever stands on another
// floor drawn apart. A wall of the ground stands as high as the floor looked
// from, as it does to a line, up to a storey laid over it. Looked at through someone's eyes, a floor they do not see
// with a storey over it is drawn as the highest solid floor there, its roof. A
// lattice is seen through: the solid floor under it is drawn (or the raised
// ground it is a ledge of), and the lattice
// over it at its own height, with its surface where one is laid on it; looked
// at from its own height, a lattice with a surface is drawn as that surface. What the board offers and what a click means are
// the same at every height; only the drawing changes.

// Board units a lattice's shadow falls aside for every metre it is over the
// floor under it, seen from above.
const SHADOW_SLANT = 0.06

export type StoreyChoice = { height: number | null; label: string }

// The ground, and each floor a storey of the board is laid at, lowest first.
export function getStoreyChoices(board: Board | null): StoreyChoice[] {
  const floors = [...new Set((board?.levels ?? []).map((level) => level.floor))].sort((a, b) => a - b)
  return [{ height: null, label: 'ground' }, ...floors.map((floor) => ({ height: floor, label: `${floor} m` }))]
}

// The height picked, or with 'auto' the floor the active character stands
// on when it is a storey's, or, on ground (a stair's step), the lowest
// storey's floor within a step above their feet in their cell or the next;
// null for the ground.
export function getViewHeight(state: SeenScene, picked: number | null | 'auto'): number | null {
  if (picked !== 'auto') return picked
  const board = state.board
  const placement = state.activeCharacterId ? board?.placements[state.activeCharacterId] : undefined
  if (!board || !placement) return null
  const footing = getTerrainAt(board, placement.cell, placement.elevation)
  if (footing.level !== null) return footing.floor
  const near = disk(placement.cell, 1).flatMap((cell) => getFloors(board, cell))
    .filter((f) => f.level !== null && f.floor >= placement.elevation && f.floor - placement.elevation < FALL.minHeight)
  return near.length > 0 ? Math.min(...near.map((f) => f.floor)) : null
}

// Whose eyes the board is looked at through: the active character's with
// 'auto', nobody's at a height picked.
export function getViewEye(state: SeenScene, picked: number | null | 'auto'): string | null {
  return picked === 'auto' && state.activeCharacterId && state.board?.placements[state.activeCharacterId] ? state.activeCharacterId : null
}

// What the cell looks like is the drawn floor's; what it offers is the view's.
const DRAWN: (keyof BoardCellView)[] = ['terrain', 'strength', 'elevation', 'wall', 'width', 'around', 'hex', 'elevationLabel', 'fire', 'fuels', 'suffocating', 'visibility', 'noise', 'climbDL', 'test', 'soft', 'surface', 'art', 'bledInto', 'zone']

const cache = new WeakMap<BoardView, Map<string, BoardView>>()

const highest = (floors: Footing[]): Footing | undefined => floors.reduce<Footing | undefined>((a, b) => (!a || b.floor > a.floor ? b : a), undefined)

export function getStoreyView(state: SeenScene, view: BoardView, height: number | null, eye: string | null = null): BoardView {
  const board = state.board
  if (!board || !view.present || board.levels.length === 0) return view
  const memo = `${height}:${eye}`
  const known = cache.get(view)?.get(memo)
  if (known) return known
  const senses = eye ? getCellSenser(state, eye) : null
  const isLattice = (key: string) => (f: Footing) => f.level !== null && !!board.levels[f.level].terrain[key]?.lattice
  const standing = (cell: Coord): Footing => {
    if (height !== null) return getTerrainAt(board, cell, height)
    const ground = board.terrain[coordKey(cell)]
    return { terrain: ground, floor: ground?.elevation ?? 0, level: null }
  }

  // For each cell: the floor looked at (the one stood on, or the roof over
  // it), the solid floor drawn (under a lattice looked at), and the lattices
  // over that with no solid floor between.
  const looks = new Map(view.cells.map((c) => {
    const floors = getFloors(board, c.cell)
    const lattice = isLattice(c.key)
    // looked at from the floor raised ground tops, a lattice with a surface
    // laid at that height (a canopy on a trunk) is what is drawn there
    const ground = board.terrain[c.key]
    const met = standing(c.cell)
    const leaves = height !== null && met.level === null ? floors.find((f) => lattice(f) && f.floor === met.floor && getFloorArt(f.terrain)) : undefined
    const stand = leaves ?? met
    const over = getRoofs(board, c.cell, stand.floor)
    // a wall of the ground is a wall wherever it is looked at from, not the
    // roof over it, and as much in sight as that roof would have been
    const roofed = !!senses && over.length > 0 && !senses(c.cell, stand.floor)
    const keptWall = roofed && stand.level === null && !!ground?.blocking
    const roof = roofed && !keptWall ? highest(over) : undefined
    const top = roof ?? stand
    const ceiling = Math.min(Infinity, ...board.levels.filter((l) => l.terrain[c.key]).map((l) => l.floor))
    const wall = !roof && height !== null && stand.level === null && !!ground?.blocking && ceiling > height
    const drawn = wall ? { terrain: ground, floor: height, level: null }
      : lattice(top) && !getFloorArt(top.terrain) ? highest(floors.filter((f) => !lattice(f) && f.floor < top.floor)) ?? floors[0]
      : top
    const higher = (f: Footing) => f.floor > drawn.floor || (drawn.level === null && f.floor === drawn.floor)
    const above = floors.filter((f) => lattice(f) && f.level !== drawn.level && higher(f) && !floors.some((g) => !lattice(g) && g.floor > drawn.floor && g.floor < f.floor))
    return [c.key, { stand, roof, wall, top, drawn, above, keptWall }]
  }))

  const terrain = { ...board.terrain }
  const moved = (key: string, f: Footing) => f.level !== null || f.floor !== (board.terrain[key]?.elevation ?? 0)
  for (const [key, { drawn }] of looks) if (moved(key, drawn) && drawn.terrain) terrain[key] = { ...drawn.terrain, elevation: drawn.floor }
  const redrawn = [...looks].some(([key, l]) => moved(key, l.drawn))
  // the ground a piece covers lends its surface to the piece's ground alone,
  // never to a storey's floor drawn in its place
  const raised = new Set([...looks].filter(([, l]) => l.drawn.level !== null).map(([key]) => key))
  const pieces = Object.fromEntries(Object.entries(board.pieces).map(([id, p]) => [id, { ...p, under: Object.fromEntries(Object.entries(p.under).filter(([key]) => !raised.has(key))) }]))
  const flat = redrawn ? getBoardView({ ...state, board: { ...board, terrain, pieces, levels: [] } }) : view
  const byKey = new Map(flat.cells.map((c) => [c.key, c]))

  const cells = view.cells.map((c): BoardCellView => {
    const d = byKey.get(c.key)
    const { stand, roof, wall, drawn, keptWall } = looks.get(c.key)!
    const hole = height !== null && board.levels.some((level) => Math.abs(level.floor - height) < FALL.minHeight && level.terrain[c.key]?.hole)
    const storey = roof ? 'roof'
      : wall ? null
      : stand.level !== null ? (board.levels[stand.level].terrain[c.key]?.lattice ? 'lattice' : 'floor')
      : hole ? 'hole'
      : height !== null && height - stand.floor >= FALL.minHeight ? 'air'
      : null
    // a wall standing up through the floor looked from is seen there, not at
    // its foot
    const unseen = wall && senses && height !== null ? !senses(c.cell, height) : c.unseen && !keptWall && !(roof && senses?.(c.cell, roof.floor))
    // a storey's floor with no surface laid on it is drawn bare, never with
    // the board's ground
    const bare = drawn.level !== null && !drawn.terrain?.surface ? { art: null } : {}
    return { ...c, ...(d && redrawn ? Object.fromEntries(DRAWN.map((k) => [k, d[k]])) : {}), ...bare, ...getCellLighting(state, c.cell, drawn.floor), storey, unseen }
  })
  const overhead: BoardOverheadView[] = view.cells.flatMap((c) => {
    const above = looks.get(c.key)!.above
    const below = looks.get(c.key)!.drawn.floor
    return [...new Set(above.map((f) => f.floor))].map((elevation) => {
      const slant = (elevation - below) * SHADOW_SLANT
      return { key: c.key, cell: c.cell, x: c.x, y: c.y, elevation, below, art: getFloorArt(above.find((f) => f.floor === elevation)?.terrain), shadow: { x: c.x + slant, y: c.y + slant }, slab: [] }
    })
  })
  const tokens = view.tokens.map((t) => {
    const placement = board.placements[t.id]
    const look = placement && looks.get(coordKey(placement.cell))
    const elsewhere = !!placement && !!look && Math.abs(getTerrainAt(board, placement.cell, placement.elevation).floor - look.top.floor) >= FALL.minHeight
    return { ...t, elsewhere }
  })
  const seen = { ...view, cells, tokens, overhead, arts: flat.arts, ridges: flat.ridges, rims: flat.rims, faces: flat.faces, bands: flat.bands }
  cache.set(view, (cache.get(view) ?? new Map()).set(memo, seen))
  return seen
}
