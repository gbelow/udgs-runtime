import type { CampaignCharacter, Character, MovementKind } from '../../types'
import type { CombatState, Coord, Degree, MoveAction, MoveFacts, Placement } from '../types'
import { MOVEMENT_BLOCK_COST } from '../../tables'
import { MOVEMENT_KINDS } from '../../lists'
import { ActionCost } from '../../character/lenses/actionCosts'
import { getAfflictions } from '../../character/lenses/afflictions'
import { getBalanceTerms } from '../../character/lenses/skills'
import { Term } from '../../character/lenses/terms'
import {
  getBasicMovement,
  getCarefulMovement,
  getCrawlMovement,
  getJumpMovement,
  getRunMovement,
  getSwimMovement,
} from '../../character/lenses/movement'
import { getSize } from '../../character/lenses/misc'
import { coordKey, directionTo, distance, neighbors, sameCell } from '../geometry'
import { getFootprint, getOccupancy } from './board'

// How a character crosses the board: what each kind of movement costs it,
// which kinds it may use from where it stands, whether a declared path is
// one it can walk, and where it could get to.

// ---------------------------------------------------------------------------
// Price

// combat.tex "Movement Costs and Speeds": metres per block of the kind.
export function getMovementSpeed(c: Character, kind: MovementKind): number {
  switch (kind) {
    case 'careful': return getCarefulMovement(c)
    case 'basic': return getBasicMovement(c)
    case 'run': return getRunMovement(c)
    case 'jump': return getJumpMovement(c)
    case 'crawl': return getCrawlMovement(c)
    case 'swim': return getSwimMovement(c)
  }
}

// combat.tex "Movement": "moving only a fraction of a space is impossible",
// so a move is bought in whole blocks, as many as cover the cells. A speed
// is printed to two places (0.33 for a third), so the quotient is read to a
// tenth before it is rounded up, or a third of a metre three times would
// cost a fourth block.
export function getMoveCost(c: Character, kind: MovementKind, cells: number): ActionCost {
  const speed = getMovementSpeed(c, kind)
  if (cells <= 0 || speed <= 0) return { AP: 0, STA: 0 }
  const blocks = Math.ceil(Math.round((cells / speed) * 10) / 10)
  const block = MOVEMENT_BLOCK_COST[kind]
  return { AP: blocks * block.AP, STA: blocks * block.STA }
}

// ---------------------------------------------------------------------------
// Which kinds

export type MovementOption = {
  kind: MovementKind
  speed: number
  block: ActionCost
  available: boolean
  reason: string | null
}

function isInLiquid(state: CombatState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  return !!placement && getFootprint(c, placement).some((cell) => state.board?.terrain[coordKey(cell)]?.liquid)
}

// combat.tex "Movement": crawling "is the only usable movement speed while
// prone", swimming "the only usable movement speed while swimming", running
// "can only be initiated during a movement surge" (combat.tex "Action
// surge": the surge allows "running until the end of the turn").
export function getMovementOptions(state: CombatState, c: CampaignCharacter): MovementOption[] {
  const prone = getAfflictions(c).includes('prone')
  const swimming = isInLiquid(state, c)
  return MOVEMENT_KINDS.map((kind) => {
    const gate = movementGate(kind, prone, swimming, c.usedSurge === 'movement')
    return { kind, speed: getMovementSpeed(c, kind), block: MOVEMENT_BLOCK_COST[kind], ...gate }
  })
}

function movementGate(kind: MovementKind, prone: boolean, swimming: boolean, surged: boolean): { available: boolean; reason: string | null } {
  if (swimming && kind !== 'swim') return { available: false, reason: 'swimming' }
  if (!swimming && kind === 'swim') return { available: false, reason: 'not in water' }
  if (prone && kind !== 'crawl') return { available: false, reason: 'prone' }
  if (kind === 'run' && !surged) return { available: false, reason: 'needs a movement surge' }
  return { available: true, reason: null }
}

// ---------------------------------------------------------------------------
// Where a footprint may stand

// creating.tex "Size and Space Occupation": "Two creatures of size 3 can
// occupy the same space, but cannot end a turn like that. A creature can
// occupy the same space as another of two sizes higher than itself." A
// footprint may be walked through anyone's cells but may only come to rest
// on cells free of everyone within a size of it.
type Ground = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  sharedBy: (cell: Coord) => string[]
}

function readGround(state: CombatState, mover: string): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  return {
    blocked: (cell) => !!board.terrain[coordKey(cell)]?.blocking,
    liquid: (cell) => !!board.terrain[coordKey(cell)]?.liquid,
    sharedBy: (cell) => (occupancy[coordKey(cell)] ?? []).filter((id) => id !== mover),
  }
}

function canRest(state: CombatState, c: Character, footprint: Coord[], ground: Ground): boolean {
  return footprint.every((cell) =>
    ground.sharedBy(cell).every((id) => {
      const other = state.characters[id]
      return other !== undefined && Math.abs(getSize(other) - getSize(c)) >= 2
    }),
  )
}

// Whether the move as declared is one its actor can make: every step a
// neighbour of the last, every footprint along the way off blocking cells
// and in the water exactly when swimming, and the last one somewhere it may
// come to rest.
export function isPathLegal(state: CombatState, action: MoveAction): boolean {
  const c = state.characters[action.actorId]
  const from = state.board?.placements[action.actorId]
  const ground = readGround(state, action.actorId)
  if (!c || !from || !ground || action.path.length === 0) return false
  if (!getMovementOptions(state, c).find((o) => o.kind === action.movement)?.available) return false
  if (action.budget && !withinBudget(getMoveCost(c, action.movement, action.path.length), action.budget)) return false

  let cursor = from.cell
  for (const [i, cell] of action.path.entries()) {
    if (distance(cursor, cell) !== 1) return false
    const last = i === action.path.length - 1
    const orientation = last && action.orientation !== null ? action.orientation : from.orientation
    const footprint = getFootprint(c, { ...from, cell, orientation })
    if (footprint.some(ground.blocked)) return false
    if (footprint.some(ground.liquid) !== (action.movement === 'swim')) return false
    if (last && !canRest(state, c, footprint, ground)) return false
    cursor = cell
  }
  return true
}

function withinBudget(cost: ActionCost, budget: ActionCost): boolean {
  return cost.AP <= budget.AP && cost.STA <= budget.STA
}

// ---------------------------------------------------------------------------
// Where the move actually ends

// combat.tex "running": "can continue running ... as long as no turns of 90
// degrees or more are made per running block". Within a block (one running
// speed of cells) the heading may stray one hex step (60 degrees) from the
// block's first step; the path is cut where it would turn harder, and the
// runner stops there. The table's ruling: turning while running stops the
// move, and the path may still be drawn past it.
export function getRunPath(state: CombatState, action: MoveAction): Coord[] {
  const c = state.characters[action.actorId]
  const from = state.board?.placements[action.actorId]
  if (!c || !from || action.movement !== 'run') return action.path
  const block = Math.max(1, Math.floor(getMovementSpeed(c, 'run')))
  let cursor = from.cell
  let heading = 0
  for (const [i, cell] of action.path.entries()) {
    const direction = directionTo(cursor, cell)
    if (i % block === 0) heading = direction
    else if (Math.min((direction - heading + 6) % 6, (heading - direction + 6) % 6) > 1) return action.path.slice(0, i)
    cursor = cell
  }
  return action.path
}

// combat.tex "Balance": crossing difficult terrain takes a Balance test, so a
// move whose path enters a difficult cell is committed by a die.
export function needsBalanceTest(state: CombatState, action: MoveAction): boolean {
  return firstDifficultStep(state, action) !== null
}

function firstDifficultStep(state: CombatState, action: MoveAction): number | null {
  const c = state.characters[action.actorId]
  const from = state.board?.placements[action.actorId]
  const board = state.board
  if (!c || !from || !board) return null
  const i = getRunPath(state, action).findIndex((cell) =>
    getFootprint(c, { ...from, cell }).some((f) => board.terrain[coordKey(f)]?.difficult),
  )
  return i === -1 ? null : i + 1
}

export function getBalanceTestTerms(c: Character): Term[] {
  return getBalanceTerms(c)
}

// The DL of the first difficult cell the move enters.
export function getBalanceDL(state: CombatState, action: MoveAction): number {
  const c = state.characters[action.actorId]
  const from = state.board?.placements[action.actorId]
  const board = state.board
  const step = firstDifficultStep(state, action)
  if (!c || !from || !board || step === null) return 0
  const cell = getRunPath(state, action)[step - 1]
  const DLs = getFootprint(c, { ...from, cell })
    .map((f) => board.terrain[coordKey(f)])
    .filter((t) => t?.difficult)
    .map((t) => t.DL)
  return Math.max(0, ...DLs)
}

// combat.tex "Balance" — "Difficult terrain": "On a critical, all movement is
// inconsequential. On a success, only moving at a normal speed is safe, but
// not jumping or running. On a graze, moving at a careful speed is safe. On
// a miss, only crawling is allowed."
export function isSafeOnDifficultTerrain(kind: MovementKind, degree: Degree): boolean {
  switch (degree) {
    case 'critical': return true
    case 'hit': return kind !== 'run' && kind !== 'jump'
    case 'graze': return kind === 'careful' || kind === 'crawl' || kind === 'swim'
    case 'miss': return kind === 'crawl'
  }
}

// The path as it will be walked and why it ends where it does: a run cut at
// a turn, a reaction that stops the mover at the step it fired on (the
// table's ruling: movement stops at the first point a reaction triggers), a
// fall at the first difficult cell the test did not clear — whichever comes
// first. The reactions read are the declared ones, so this is final once the
// action is committed.
export function getMoveFacts(state: CombatState, action: MoveAction): MoveFacts {
  const run = getRunPath(state, action)
  let path = run
  let stop: MoveFacts['stop'] = run.length < action.path.length ? 'turn' : 'end'
  const at = state.actions
    .filter((a) => a.reactionTo === action.id && a.kind === 'opportunityAttack')
    .map((a) => (a.kind === 'opportunityAttack' ? a.at : null))
    .filter((n): n is number => n !== null)
  if (at.length > 0 && Math.min(...at) < path.length) {
    path = path.slice(0, Math.min(...at))
    stop = 'reaction'
  }
  const difficult = firstDifficultStep(state, action)
  const fell = difficult !== null && difficult <= path.length && action.roll !== null && !isSafeOnDifficultTerrain(action.movement, action.roll.degree)
  if (fell) {
    path = path.slice(0, difficult)
    stop = 'fall'
  }
  return { path, stop, fell }
}

// Where the move ends: the last cell of the path as walked, the orientation
// it named, the elevation of the ground there — the board's terrain says how
// high a cell is, so a placement carried in from a VTT is re-read off it on
// the first move.
export function getMoveDestination(state: CombatState, action: MoveAction, path: Coord[]): Placement | null {
  const from = state.board?.placements[action.actorId]
  const cell = path[path.length - 1]
  if (!from || !cell) return null
  return {
    ...from,
    cell,
    orientation: action.orientation ?? from.orientation,
    elevation: state.board?.terrain[coordKey(cell)]?.elevation ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Reach of a move

export type ReachableCell = { cell: Coord; steps: number; cost: ActionCost; path: Coord[] }

// Every anchor the character can walk to at the kind of movement and pay
// for as they stand, with the shortest path there: a breadth-first walk over
// cells its footprint (as oriented now) may cross, stopping where the price
// outruns what it has. Cells it may cross but not rest on are walked
// through and left out.
export function getReachableCells(state: CombatState, actorId: string, kind: MovementKind): ReachableCell[] {
  const c = state.characters[actorId]
  const from = state.board?.placements[actorId]
  const ground = readGround(state, actorId)
  if (!c || !from || !ground) return []
  if (!getMovementOptions(state, c).find((o) => o.kind === kind)?.available) return []

  const affordable = (cost: ActionCost) => cost.AP <= c.resources.AP && cost.STA <= c.resources.STA
  const crossable = (cell: Coord) => {
    const footprint = getFootprint(c, { ...from, cell })
    return !footprint.some(ground.blocked) && footprint.some(ground.liquid) === (kind === 'swim')
  }

  const seen = new Set([coordKey(from.cell)])
  const reachable: ReachableCell[] = []
  let frontier: { cell: Coord; path: Coord[] }[] = [{ cell: from.cell, path: [] }]
  for (let steps = 1; frontier.length > 0; steps++) {
    const cost = getMoveCost(c, kind, steps)
    if (!affordable(cost)) break
    const next: typeof frontier = []
    for (const { cell, path } of frontier) {
      for (const n of neighbors(cell)) {
        const key = coordKey(n)
        if (seen.has(key) || !crossable(n)) continue
        seen.add(key)
        const walked = [...path, n]
        next.push({ cell: n, path: walked })
        if (canRest(state, c, getFootprint(c, { ...from, cell: n }), ground)) reachable.push({ cell: n, steps, cost, path: walked })
      }
    }
    frontier = next
  }
  return reachable
}

export function findReachable(cells: ReachableCell[], cell: Coord): ReachableCell | null {
  return cells.find((r) => sameCell(r.cell, cell)) ?? null
}

// Whether a footprint may be put down here outside of any move: off
// blocking cells and free of everyone within a size. What a placement by
// hand has to respect.
export function canStandAt(state: CombatState, id: string, placement: Placement): boolean {
  const c = state.characters[id]
  const ground = readGround(state, id)
  if (!c || !ground) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(ground.blocked) && canRest(state, c, footprint, ground)
}

// The path a click on a cell turns the declared one into: the cell taken
// back if it is the path's end, one more step if it is next to the end,
// the shortest way there if it is reachable at all, and nothing otherwise.
export function pickPathCell(state: CombatState, action: MoveAction, cell: Coord): Coord[] | null {
  const from = state.board?.placements[action.actorId]
  if (!from) return null
  const end = action.path[action.path.length - 1] ?? from.cell
  if (action.path.length > 0 && sameCell(end, cell)) return action.path.slice(0, -1)
  const reachable = getReachableCells(state, action.actorId, action.movement)
  const there = findReachable(reachable, cell)
  if (!there) return null
  if (distance(end, cell) === 1 && there.steps > action.path.length) return [...action.path, cell]
  return there.path
}
