import type { CombatState, Coord } from '../types'
import type { ActionCost } from '../../character/lenses/actionCosts'
import { coordKey, disk, sameCell } from '../geometry'
import { getFootprint, getOccupancy, toPlane } from './board'
import { findOption, getNextStep, getOpenAction, getReactionsTo, getRole, getTargetIds, Role } from './action'
import { getEvasiveJumpPlacements, getReachableCells } from './move'

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

// What a click on a cell does right now.
export type BoardMode = 'idle' | 'path' | 'jump' | 'locked'

export type BoardView = {
  present: boolean
  radius: number
  // the SVG viewBox that frames every cell, with a margin
  viewBox: string
  // one hexagon's corners around its centre, as an SVG `points` string
  hex: string
  cells: BoardCellView[]
  tokens: BoardTokenView[]
  // characters in the fight with no place on the board yet
  unplaced: { id: string; name: string }[]
  mode: BoardMode
  // the open move, if one is being declared: its actor and orientation
  move: { actorId: string; orientation: number; canTurn: boolean } | null
}

const EMPTY: BoardView = { present: false, radius: 0, viewBox: '0 0 1 1', hex: '', cells: [], tokens: [], unplaced: [], mode: 'locked', move: null }

// The move in play, whatever its phase: declared, committed, waiting on an
// opportunity attack fought against it, or waiting to resolve. Its path
// stays drawn throughout.
function getPendingMove(state: CombatState) {
  const move = state.actions.find((a) => a.kind === 'move' && a.reactionTo === null && a.status !== 'resolved')
  return move?.kind === 'move' ? move : null
}

const HEX = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30)
  return `${(Math.cos(angle)).toFixed(4)},${(Math.sin(angle)).toFixed(4)}`
}).join(' ')

export function getBoardView(state: CombatState): BoardView {
  const board = state.board
  if (!board) return { ...EMPTY, unplaced: Object.values(state.characters).map((c) => ({ id: c.id, name: c.fightName ?? '' })) }

  const open = getOpenAction(state)
  const step = getNextStep(state)
  const pending = getPendingMove(state)
  const move = open?.kind === 'move' && open.status === 'declared' ? open : null
  const targets = new Set(open && step === 'target' ? getTargetIds(state, open) : [])
  const occupancy = getOccupancy(board, state.characters)
  const reachable = move ? getReachableCells(state, move.actorId, move.movement) : []
  const reachableByKey = new Map(reachable.map((r) => [coordKey(r.cell), r]))
  const pathByKey = new Map((pending?.path ?? []).map((cell, i) => [coordKey(cell), i + 1]))
  const destination = pending?.path[pending.path.length - 1] ?? null

  // the landings open to the target of a committed strike, while the jump
  // is still theirs to declare
  const jumper = open?.kind === 'strike' && open.status === 'committed' && open.targetId && findOption(state, open.targetId, { kind: 'evasiveJump' })?.available ? open.targetId : null
  const landings = new Set(jumper && open ? getEvasiveJumpPlacements(state, jumper, open.actorId).map((p) => coordKey(p.cell)) : [])
  const jump = open && jumper ? getReactionsTo(state, open.id).find((r) => r.actorId === jumper && r.kind === 'evasiveJump') : undefined
  const jumpTo = jump?.kind === 'evasiveJump' ? jump.to?.cell ?? null : null

  // The drawn extent: the disk of the board's radius, plus anything placed
  // or painted beyond it.
  const extent = new Map(disk(board.origin, board.radius).map((c) => [coordKey(c), c]))
  for (const key of [...Object.keys(board.terrain), ...Object.keys(occupancy)]) {
    if (!extent.has(key)) {
      const [q, r] = key.split(',').map(Number)
      extent.set(key, { q, r })
    }
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
    }
  })

  const tokens: BoardTokenView[] = Object.entries(board.placements).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    const footprint = getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) }))
    const anchor = toPlane(placement.cell)
    return [{
      id,
      name: c.fightName ?? '',
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
    unplaced: Object.values(state.characters).filter((c) => !board.placements[c.id]).map((c) => ({ id: c.id, name: c.fightName ?? '' })),
    mode: move ? 'path' : landings.size > 0 ? 'jump' : open ? 'locked' : 'idle',
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
