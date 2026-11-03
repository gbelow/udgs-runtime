import type { Board, Coord, SeenScene } from '../types'
import { FALL } from '../../tables'
import { coordKey, disk } from '../rules/board/geometry'
import { getFloors, getRoofs, getStoreyFloor, getTerrainAt, type Footing } from '../rules/board/board'
import { getCellSenser } from '../rules/detection'
import { getCellLighting } from '../rules/board/light'
import { getFloorArt } from '../rules/board/surface'
import { perParts } from '../../perState'
import { getBoardGround, getGroundMarks, getRidges, getRimMarks, rimOwner, type BoardCellView, type BoardGround, type BoardGroundCell, type BoardOverheadView, type BoardView } from './boardView'

// The board looked at from a height: each cell drawn as the floor someone
// whose feet are there stands on (`getTerrainAt`), the cells where they would
// fall veiled as open air over the ground, and whoever stands on another
// floor drawn apart. A wall of the ground stands as high as the floor looked
// from, as it does to a line, up to a storey laid over it. Looked at through someone's eyes, a floor with a storey
// over it is drawn as the highest solid floor there, its roof, where they do
// not see it from under a roof of their own, and wherever it is when they
// stand under none. A
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

// The height picked, or with 'auto' the lowest floor of another storey within
// a step above the active character's feet in their cell or the next (a
// stair's top), else the floor of the storey they stand on; null for the
// ground.
export function getViewHeight(state: SeenScene, picked: number | null | 'auto'): number | null {
  if (picked !== 'auto') return picked
  const board = state.board
  const placement = state.activeCharacterId ? board?.placements[state.activeCharacterId] : undefined
  if (!board || !placement) return null
  const footing = getTerrainAt(board, placement.cell, placement.elevation)
  const near = disk(placement.cell, 1).flatMap((cell) => getFloors(board, cell))
    .flatMap((f) => (f.level !== null && f.level !== footing.level && f.floor >= placement.elevation && f.floor - placement.elevation < FALL.minHeight ? [board.levels[f.level].floor] : []))
  return near.length > 0 ? Math.min(...near) : footing.level === null ? null : board.levels[footing.level].floor
}

// Whose eyes the board is looked at through: the active character's with
// 'auto', nobody's at a height picked.
export function getViewEye(state: SeenScene, picked: number | null | 'auto'): string | null {
  return picked === 'auto' && state.activeCharacterId && state.board?.placements[state.activeCharacterId] ? state.activeCharacterId : null
}

// What the cell looks like is the drawn floor's; what it offers is the view's.
const DRAWN: (keyof BoardGroundCell)[] = ['terrain', 'strength', 'elevation', 'wall', 'width', 'around', 'hex', 'elevationLabel', 'noise', 'climbDL', 'test', 'soft', 'surface', 'art', 'bledInto']

const highest = (floors: Footing[]): Footing | undefined => floors.reduce<Footing | undefined>((a, b) => (!a || b.floor > a.floor ? b : a), undefined)

const isLatticeIn = (board: Board, key: string) => (f: Footing) => f.level !== null && !!board.levels[f.level].terrain[key]?.lattice

// What a cell is looked at as from a height, before anyone's eyes decide which
// roofs are drawn: every floor in it, the one stood on, and the roofs over that.
type Standing = { cell: Coord; floors: Footing[]; stand: Footing; over: Footing[] }

const standingsOf = perParts<Map<string, Standing>>()

function getStandings(board: Board, ground: BoardGround, height: number | null): Map<string, Standing> {
  return standingsOf([ground], `${height}`, () => {
    // a storey looked at from its own floor shows its raised cells (a stair's
    // steps) however high they rise
    const standing = (cell: Coord): Footing => {
      if (height !== null) {
        const met = getTerrainAt(board, cell, height)
        const step = highest(getFloors(board, cell).filter((f) => f.level !== null && board.levels[f.level].floor === height))
        return step && step.floor > met.floor ? step : met
      }
      const ground = board.terrain[coordKey(cell)]
      return { terrain: ground, floor: ground?.elevation ?? 0, level: null }
    }
    return new Map(ground.cells.map((c) => {
      const floors = getFloors(board, c.cell)
      const lattice = isLatticeIn(board, c.key)
      // looked at from the floor raised ground tops, a lattice with a surface
      // laid at that height (a canopy on a trunk) is what is drawn there
      const met = standing(c.cell)
      const leaves = height !== null && met.level === null ? floors.find((f) => lattice(f) && f.floor === met.floor && getFloorArt(f.terrain)) : undefined
      const stand = leaves ?? met
      return [c.key, { cell: c.cell, floors, stand, over: getRoofs(board, c.cell, stand.floor) }]
    }))
  })
}

// For each cell: the floor stood on, the roof drawn over it if any, whether a
// wall of the ground stands up through the floor looked from, the floor looked
// at, and the floor drawn.
type Look = { stand: Footing; roof: Footing | undefined; wall: boolean; top: Footing; drawn: Footing }

// The board drawn at a height with these roofs: its ground, the copy of the
// board flattened to the floors drawn (null where every cell is drawn at its
// own ground), and what each cell is looked at as.
type Storey = { ground: BoardGround; flat: Board | null; looks: Map<string, Look> }

const storeyOf = perParts<Storey>()

function getStorey(board: Board, ground: BoardGround, height: number | null, roofs: Set<string>): Storey {
  return storeyOf([ground], `${height}|${[...roofs].join(' ')}`, () => buildStorey(board, ground, height, roofs))
}

function buildStorey(board: Board, ground: BoardGround, height: number | null, roofs: Set<string>): Storey {
  const standings = getStandings(board, ground, height)

  // For each cell: the floor looked at (the one stood on, or the roof over
  // it), the solid floor drawn (under a lattice looked at), and the lattices
  // over that with no solid floor between.
  const above = new Map<string, Footing[]>()
  const looks = new Map(ground.cells.map((c): [string, Look] => {
    const { floors, stand, over } = standings.get(c.key)!
    const lattice = isLatticeIn(board, c.key)
    const own = board.terrain[c.key]
    // looked at from the top down: under a roof, what is not seen from inside,
    // and all of it from outside (walls, and rooms seen through a window), is
    // drawn as the highest roof over it
    const roof = roofs.has(c.key) ? highest(over) : undefined
    const top = roof ?? stand
    const ceiling = Math.min(Infinity, ...board.levels.flatMap((l) => (l.terrain[c.key] ? [getStoreyFloor(l, l.terrain[c.key])] : [])))
    const wall = !roof && height !== null && stand.level === null && !!own?.blocking && ceiling > height
    const drawn = wall ? { terrain: own, floor: height, level: null }
      : lattice(top) && !getFloorArt(top.terrain) ? highest(floors.filter((f) => !lattice(f) && f.floor < top.floor)) ?? floors[0]
      : top
    const higher = (f: Footing) => f.floor > drawn.floor || (drawn.level === null && f.floor === drawn.floor)
    above.set(c.key, floors.filter((f) => lattice(f) && f.level !== drawn.level && higher(f) && !floors.some((g) => !lattice(g) && g.floor > drawn.floor && g.floor < f.floor)))
    return [c.key, { stand, roof, wall, top, drawn }]
  }))

  const terrain = { ...board.terrain }
  const moved = (key: string, f: Footing) => f.level !== null || f.floor !== (board.terrain[key]?.elevation ?? 0)
  for (const [key, { drawn }] of looks) if (moved(key, drawn) && drawn.terrain) terrain[key] = { ...drawn.terrain, elevation: drawn.floor }
  const redrawn = [...looks].some(([key, l]) => moved(key, l.drawn))
  // the ground a piece covers lends its surface to the piece's ground alone,
  // never to a storey's floor drawn in its place
  const raised = new Set([...looks].filter(([, l]) => l.drawn.level !== null).map(([key]) => key))
  const pieces = Object.fromEntries(Object.entries(board.pieces).map(([id, p]) => [id, { ...p, under: Object.fromEntries(Object.entries(p.under).filter(([key]) => !raised.has(key))) }]))
  const flat = redrawn ? { ...board, terrain, pieces, levels: [] } : null
  const drawnGround = flat ? getBoardGround(flat, ground.beyond) : ground
  const byKey = new Map(drawnGround.cells.map((c) => [c.key, c]))

  const cells = ground.cells.map((c): BoardGroundCell => {
    const d = byKey.get(c.key)
    const { stand, roof, wall, drawn } = looks.get(c.key)!
    const hole = height !== null && board.levels.some((level) => Math.abs(level.floor - height) < FALL.minHeight && level.terrain[c.key]?.hole)
    const storey = roof ? 'roof'
      : wall ? null
      : stand.level !== null ? (board.levels[stand.level].terrain[c.key]?.lattice ? 'lattice' : 'floor')
      : hole ? 'hole'
      : height !== null && height - stand.floor >= FALL.minHeight ? 'air'
      : null
    // a storey's floor with no surface laid on it is drawn bare, never with
    // the board's ground
    const bare = drawn.level !== null && !drawn.terrain?.surface ? { art: null } : {}
    return { ...c, ...(d && flat ? Object.fromEntries(DRAWN.map((k) => [k, d[k]])) : {}), ...bare, storey }
  })
  const overhead: BoardOverheadView[] = ground.cells.flatMap((c) => {
    const lattices = above.get(c.key)!
    const below = looks.get(c.key)!.drawn.floor
    return [...new Set(lattices.map((f) => f.floor))].map((elevation) => {
      const slant = (elevation - below) * SHADOW_SLANT
      return { key: c.key, cell: c.cell, x: c.x, y: c.y, elevation, below, art: getFloorArt(lattices.find((f) => f.floor === elevation)?.terrain), shadow: { x: c.x + slant, y: c.y + slant }, slab: [] }
    })
  })
  // each drop painted by what stands in its cell on the board as it is, not
  // on the flattened copy it is drawn from
  const cliffs = flat ? getRidges(flat, drawnGround.cells, board, drawnGround.corners) : ground
  return {
    ground: { ...ground, cells, overhead, arts: drawnGround.arts, ridges: cliffs.ridges, chords: drawnGround.chords, corners: drawnGround.corners, rims: drawnGround.rims, faces: cliffs.faces, bands: drawnGround.bands },
    flat,
    looks,
  }
}

const cache = new WeakMap<BoardView, Map<string, BoardView>>()

export function getStoreyView(state: SeenScene, view: BoardView, height: number | null, eye: string | null = null): BoardView {
  const board = state.board
  if (!board || !view.present || board.levels.length === 0) return view
  const memo = `${height}:${eye}`
  const known = cache.get(view)?.get(memo)
  if (known) return known
  const senses = eye ? getCellSenser(state, eye) : null
  // an eye with no roof over its own feet is outside, and sees no roof lifted
  const feet = eye ? board.placements[eye] : undefined
  const outside = !!feet && getRoofs(board, feet.cell, feet.elevation).length === 0
  const standings = getStandings(board, view.ground, height)
  const roofs = new Set(senses ? [...standings].flatMap(([key, s]) => (s.over.length > 0 && (outside || !senses(s.cell, s.stand.floor)) ? [key] : [])) : [])
  const { ground, flat, looks } = getStorey(board, view.ground, height, roofs)

  // what play leaves on the ground is read off the floor drawn
  const flatState = flat ? { ...state, board: { ...board, terrain: flat.terrain, pieces: flat.pieces, levels: flat.levels } } : null
  const left = flatState ? getGroundMarks(flatState) : null
  const drawnCells = new Map(ground.cells.map((c) => [c.key, c]))
  const cells = view.cells.map((c): BoardCellView => {
    const { roof, wall, drawn } = looks.get(c.key)!
    // a wall standing up through the floor looked from is seen there, not at
    // its foot
    const unseen = wall && senses && height !== null ? !senses(c.cell, height) : c.unseen && !(roof && senses?.(c.cell, roof.floor))
    return { ...c, ...drawnCells.get(c.key)!, ...(left ? left(c.key, c.cell) : {}), ...getCellLighting(state, c.cell, drawn.floor), unseen }
  })
  const rims: BoardCellView[] = flatState && left
    ? ground.rims.map((r) => {
      const owner = drawnCells.get(rimOwner(r.key))!
      return { ...r, ...getRimMarks({ visibility: left(owner.key, owner.cell).visibility, ...getCellLighting(flatState, owner.cell), unseen: false }) }
    })
    : view.rims
  const tokens = view.tokens.map((t) => {
    const placement = board.placements[t.id]
    const look = placement && looks.get(coordKey(placement.cell))
    const elsewhere = !!placement && !!look && Math.abs(getTerrainAt(board, placement.cell, placement.elevation).floor - look.top.floor) >= FALL.minHeight
    return { ...t, elsewhere }
  })
  const seen = { ...view, ground, cells, tokens, rims, overhead: ground.overhead, arts: ground.arts, ridges: ground.ridges, chords: ground.chords, faces: ground.faces, bands: ground.bands }
  cache.set(view, (cache.get(view) ?? new Map()).set(memo, seen))
  return seen
}
