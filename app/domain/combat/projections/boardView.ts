import type { CombatState, Coord, Degree } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { coordKey, disk, parseCoordKey, sameCell } from '../geometry'
import { getFootprint, getOccupancy, toPlane } from '../rules/board'
import { findOption } from '../rules/options'
import { findOpenRoot, getNextStep, getOpenAction, getReactionsTo, getTargetIds } from '../rules/action'
import { getRole, type Role } from './roster'
import { getFightName } from '../rules/activeCharacter'
import { getExplosionCenters, getExplosionZones, getThreatenedCells, isAimable } from '../rules/explosion'
import { getEvasiveJumpPlacements, getReachableCells } from '../rules/move'
import { getCircleCells, getDragFacts } from '../rules/grapple'
import { canPickUp, getReachableFloor } from '../rules/floor'

// The board as the simulation tool draws it: every cell with what is on it
// and what a click there would mean, every placed character with the cells
// it covers, and the plane coordinates of all of it — pointy-top hexes of
// unit spacing, so the panel only has to translate and scale.

export type CellTerrain = 'open' | 'wall' | 'water' | 'rough'

export type BoardCellView = {
  key: string
  cell: Coord
  x: number
  y: number
  terrain: CellTerrain
  elevation: number
  elevationLabel: string
  occupants: string[]
  // what the open move could reach here, if this cell is in its reach
  reachable: { steps: number; cost: ActionCost } | null
  // this cell's place on the path of the move in play, counted from 1; null
  // off it
  pathStep: number | null
  isDestination: boolean
  // where the target of the open strike could land an evasive jump, and the
  // landing it has picked
  jump: boolean
  isJumpTo: boolean
  // the explosion in play: where it may be aimed, where it is aimed, what
  // it may still reach, and the degree of effect where it goes off
  center: boolean
  isCenter: boolean
  threatened: boolean
  zone: Degree | null
  // what lies on the floor here
  items: string[]
  // where the actor of a settled push may circle round to
  circle: boolean
}

export type BoardTokenView = {
  id: string
  name: string
  x: number
  y: number
  cells: { key: string; x: number; y: number }[]
  elevation: number
  orientation: number
  isActive: boolean
  isInTurn: boolean
  role: Role | null
  targetable: boolean
}

// Something lying on a cell, drawn over whoever stands there, and whether a
// click on it would pick it up: the active character with nothing open, or
// the one whose pick up is being declared, reaching it with a free hand.
// `x`/`y` put it at its cell's corner, items sharing a cell stacked
// downwards.
export type BoardFloorItemView = {
  itemId: string
  name: string
  x: number
  y: number
  pickable: boolean
}

export type BoardGhostView = {
  id: string
  name: string
  x: number
  y: number
  cells: { key: string; x: number; y: number }[]
}

// What a click on a cell does right now.
export type BoardMode = 'idle' | 'path' | 'jump' | 'aim' | 'locked'

export type BoardView = {
  present: boolean
  radius: number
  // the SVG viewBox that frames every cell, with a margin
  viewBox: string
  // one hexagon's corners around its centre, as an SVG `points` string
  hex: string
  cells: BoardCellView[]
  tokens: BoardTokenView[]
  floor: BoardFloorItemView[]
  // combat.tex "Push and drag": where everyone the settled push moves will
  // stand once it lands, drawn over the board before it does
  ghosts: BoardGhostView[]
  // who a click on a pickable floor item picks it up for
  picker: string | null
  // characters in the fight with no place on the board yet
  unplaced: { id: string; name: string }[]
  mode: BoardMode
  // the open move, if one is being declared: its actor and orientation
  move: { actorId: string; orientation: number; canTurn: boolean } | null
}

const EMPTY: BoardView = { present: false, radius: 0, viewBox: '0 0 1 1', hex: '', cells: [], tokens: [], floor: [], ghosts: [], picker: null, unplaced: [], mode: 'locked', move: null }

const HEX = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30)
  return `${(Math.cos(angle)).toFixed(4)},${(Math.sin(angle)).toFixed(4)}`
}).join(' ')

export function getBoardView(state: CombatState): BoardView {
  const board = state.board
  if (!board) return { ...EMPTY, unplaced: Object.values(state.characters).map((c) => ({ id: c.id, name: getFightName(state, c.id) })) }

  const open = getOpenAction(state)
  const step = getNextStep(state)
  // the move in play, whatever its phase: its path stays drawn throughout
  const pending = findOpenRoot(state, 'move')
  const move = open?.kind === 'move' && open.status === 'declared' ? open : null
  const targets = new Set(open && step === 'target' ? getTargetIds(state, open) : [])
  const occupancy = getOccupancy(board, state.characters)
  const reachable = move ? getReachableCells(state, move) : []
  const reachableByKey = new Map(reachable.map((r) => [coordKey(r.cell), r]))
  const pathByKey = new Map((pending?.path ?? []).map((cell, i) => [coordKey(cell), i + 1]))
  const destination = pending?.path[pending.path.length - 1] ?? null

  // the landings open to the target of a committed strike, while the jump
  // is still theirs to declare
  const jumper = open?.kind === 'strike' && open.status === 'committed' && open.targetId && findOption(state, open.targetId, { kind: 'evasiveJump' })?.available ? open.targetId : null
  const landings = new Set(jumper && open ? getEvasiveJumpPlacements(state, jumper, open.actorId).map((p) => coordKey(p.cell)) : [])
  const jump = open && jumper ? getReactionsTo(state, open.id).find((r) => r.actorId === jumper && r.kind === 'evasiveJump') : undefined
  const jumpTo = jump?.kind === 'evasiveJump' ? jump.to?.cell ?? null : null

  // the explosion in play: the centres it may be aimed at, what it
  // threatens, and its zones once it is pointed. It stays aimable for as
  // long as it can be re-aimed — a disk until its actor commits, a spray
  // until the blast is confirmed (combat.tex "Sprays": the direction is
  // chosen after the movement).
  const explosion = findOpenRoot(state, 'explosion')
  // combat.tex "Push and drag": once settled, the winner points the push or
  // picks where to circle on the board, until the third parties are fought
  const settled = open?.kind === 'drag' && open.status === 'rolled' ? open : null
  const pointing = settled !== null && !settled.fought && (settled.choice === 'push' || settled.choice === 'circle')
  const aiming = (explosion !== null && isAimable(state, explosion)) || pointing
  const circling = new Set(settled && pointing && settled.choice === 'circle' ? getCircleCells(state, settled).map((c) => coordKey(c.cell)) : [])
  const landed = settled ? getDragFacts(state, settled)?.to ?? {} : {}
  const ghosts: BoardGhostView[] = Object.entries(landed).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    return [{ id, name: getFightName(state, id), ...toPlane(placement.cell), cells: getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) })) }]
  })
  const centers = new Set(explosion && explosion.status === 'declared' ? getExplosionCenters(state, explosion).map(coordKey) : [])
  const threatened = new Set(explosion ? getThreatenedCells(state, explosion).map(coordKey) : [])
  const zones = new Map(explosion ? getExplosionZones(state, explosion).map((z) => [coordKey(z.cell), z.degree]) : [])

  // The drawn extent: the disk of the board's radius, plus anything placed,
  // painted or threatened beyond it.
  const extent = new Map(disk(board.origin, board.radius).map((c) => [coordKey(c), c]))
  for (const key of [...Object.keys(board.terrain), ...Object.keys(occupancy), ...threatened]) {
    const cell = parseCoordKey(key)
    if (cell && !extent.has(key)) extent.set(key, cell)
  }

  const cells: BoardCellView[] = [...extent.values()].map((cell) => {
    const key = coordKey(cell)
    const terrain = board.terrain[key]
    const { x, y } = toPlane(cell)
    const there = reachableByKey.get(key)
    return {
      key,
      cell,
      x,
      y,
      terrain: terrain?.blocking ? 'wall' : terrain?.liquid ? 'water' : terrain?.difficult ? 'rough' : 'open',
      elevation: terrain?.elevation ?? 0,
      elevationLabel: elevationLabel(terrain?.elevation ?? 0),
      occupants: occupancy[key] ?? [],
      reachable: there ? { steps: there.steps, cost: there.cost } : null,
      pathStep: pathByKey.get(key) ?? null,
      isDestination: destination !== null && sameCell(destination, cell),
      jump: landings.has(key),
      isJumpTo: jumpTo !== null && sameCell(jumpTo, cell),
      center: centers.has(key),
      isCenter: explosion?.center !== null && explosion?.center !== undefined && sameCell(explosion.center, cell),
      threatened: threatened.has(key),
      zone: zones.get(key) ?? null,
      items: state.floor.filter((f) => f.cell !== null && sameCell(f.cell, cell)).map((f) => f.item.name),
      circle: circling.has(key),
    }
  })

  const tokens: BoardTokenView[] = Object.entries(board.placements).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    const footprint = getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) }))
    const anchor = toPlane(placement.cell)
    return [{
      id,
      name: getFightName(state, id),
      x: anchor.x,
      y: anchor.y,
      cells: footprint,
      elevation: placement.elevation,
      orientation: placement.orientation,
      isActive: id === state.activeCharacterId,
      isInTurn: id === state.inTurnCharacter,
      role: open ? getRole(state, open, id) : null,
      targetable: targets.has(id),
    }]
  })

  const picker = open?.kind === 'pickUp' && open.status === 'declared' ? open.actorId
    : !open && state.activeCharacterId && findOption(state, state.activeCharacterId, { kind: 'pickUp' })?.available ? state.activeCharacterId
    : null
  const pickerCharacter = picker ? state.characters[picker] : undefined
  const pickable = new Set(pickerCharacter ? getReachableFloor(state, pickerCharacter.id).filter((f) => canPickUp(pickerCharacter, f.item)).map((f) => f.item.id) : [])
  const stacks = new Map<string, number>()
  const floor: BoardFloorItemView[] = state.floor.flatMap((f) => {
    if (!f.cell) return []
    const key = coordKey(f.cell)
    const stack = stacks.get(key) ?? 0
    stacks.set(key, stack + 1)
    const { x, y } = toPlane(f.cell)
    return [{ itemId: f.item.id, name: f.item.name, x: x + 0.55, y: y - 0.5 + stack * 0.36, pickable: pickable.has(f.item.id) }]
  })

  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const minX = Math.min(...xs) - 1
  const minY = Math.min(...ys) - 1
  const width = Math.max(...xs) + 1 - minX
  const height = Math.max(...ys) + 1 - minY

  const mover = move ? board.placements[move.actorId] : undefined
  return {
    present: true,
    radius: board.radius,
    viewBox: `${minX.toFixed(3)} ${minY.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}`,
    hex: HEX,
    cells,
    tokens,
    floor,
    ghosts,
    picker: pickable.size > 0 ? picker : null,
    unplaced: Object.values(state.characters).filter((c) => !board.placements[c.id]).map((c) => ({ id: c.id, name: getFightName(state, c.id) })),
    mode: move ? 'path' : landings.size > 0 ? 'jump' : aiming ? 'aim' : open ? 'locked' : 'idle',
    move: move && mover
      ? { actorId: move.actorId, orientation: move.orientation ?? mover.orientation, canTurn: getFootprint(state.characters[move.actorId], mover).length > 1 }
      : null,
  }
}

function elevationLabel(elevation: number): string {
  return elevation > 0 ? `+${elevation}` : elevation < 0 ? `${elevation}` : ''
}

export function getBoardViewDigest(state: CombatState): string {
  return JSON.stringify(getBoardView(state))
}
