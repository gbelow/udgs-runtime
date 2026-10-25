import type { MoveKind } from '../../../types'
import type { SceneState, Coord, MoveAction, Placement } from '../../types'
import { sameCell, setDistance } from './geometry'
import { getFootprint, getPlacedFootprint, placeAt } from './board'

// Where the mover stands along a move: where it sets out from, each step of
// the path, and where it ends.

// Whether a move touches the ground at a step of its way — where it sets
// out, a cell it passes, or where it `lands`: all of them for a walk, only
// the landing for a jump. combat.tex "Movement" — the table's ruling: a jump
// skips the cells in between.
export function touchesGround(kind: MoveKind, lands: boolean): boolean {
  return kind !== 'jump' || lands
}

// Where the move sets out from: the placement the commit wrote down, or
// while it is still being declared, where the actor stands.
export function getMoveOrigin(state: SceneState, action: MoveAction): Placement | undefined {
  return action.from ?? state.board?.placements[action.actorId]
}

// Where the drawn path turns: the lengths it had at the end of each segment
// but the last, those that still fall inside it.
export function getPathTurns(action: MoveAction): number[] {
  return action.turns.filter((t) => t > 0 && t < action.path.length)
}

// The path with its last segment taken back, and the turns left on it.
export function withoutLastSegment(action: MoveAction): { path: Coord[]; turns: number[] } {
  const turns = getPathTurns(action)
  return { path: action.path.slice(0, turns.at(-1) ?? 0), turns: turns.slice(0, -1) }
}

// Where the mover stands part of the way along the move: the anchor at that
// step, as oriented when they set out, and on the last step turned the way
// the move names. Null at step 0, where they have not left the origin.
export function getMoveWaypoint(state: SceneState, action: MoveAction, steps: number): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = action.path[steps - 1]
  if (!from || !cell || steps <= 0) return null
  const orientation = steps === action.path.length ? action.orientation ?? from.orientation : from.orientation
  return { ...placeAt(state.board, from, cell), orientation }
}

// Where the mover stands at every step of the move: where it sets out, then
// each step of the path.
export function getMovePlacements(state: SceneState, action: MoveAction): Placement[] {
  const from = getMoveOrigin(state, action)
  if (!from) return []
  return [from, ...action.path.flatMap((_, i) => getMoveWaypoint(state, action, i + 1) ?? [])]
}

// The cells the mover's token covers at each step of the path, the first
// entry for the first step: every space the move passes over, for a token
// of any size.
export function getMoveSweep(state: SceneState, action: MoveAction): Coord[][] {
  const c = state.characters[action.actorId]
  if (!c) return []
  return getMovePlacements(state, action).slice(1).map((p) => getFootprint(c, p))
}

// The step of the move's path (counted from 1) that first comes into the
// character's space, null for one it never does.
export function getEnteringStep(state: SceneState, root: MoveAction, id: string): number | null {
  const other = getPlacedFootprint(state, id)
  if (!other) return null
  const step = getMoveSweep(state, root).findIndex((footprint) => footprint.some((f) => other.some((o) => sameCell(f, o))))
  return step === -1 ? null : step + 1
}

// Where the mover stands either side of the step into the `at`th cell of
// the move: before it, at the origin for the first step.
export function getStepPlacements(state: SceneState, action: MoveAction, at: number): { before: Placement; after: Placement } | null {
  const before = at <= 1 ? getMoveOrigin(state, action) : getMoveWaypoint(state, action, at - 1)
  const after = getMoveWaypoint(state, action, at)
  return before && after ? { before, after } : null
}

// How the step into the `at`th cell of the move changes the mover's distance
// to someone: below zero towards them, above away from them.
export function getStepDelta(state: SceneState, action: MoveAction, at: number, otherId: string): number | null {
  const mover = state.characters[action.actorId]
  const other = getPlacedFootprint(state, otherId)
  const step = getStepPlacements(state, action, at)
  if (!mover || !other || !step) return null
  return setDistance(getFootprint(mover, step.after), other) - setDistance(getFootprint(mover, step.before), other)
}

// combat.tex "Hook Attack": a runner stepping away from the attacker (the
// step the hook's reaction fires on).
export function isHookedRunner(state: SceneState, action: MoveAction, at: number, attackerId: string): boolean {
  return action.movement === 'run' && (getStepDelta(state, action, at, attackerId) ?? 0) > 0
}

// Where the move ends: the last cell of the path as walked, the orientation
// it named, the elevation of the ground there — the board's terrain says how
// high a cell is, so a placement carried in from a VTT is re-read off it on
// the first move.
export function getMoveDestination(state: SceneState, action: MoveAction, path: Coord[]): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = path[path.length - 1]
  if (!from) return null
  if (!cell) return action.path.length === 0 ? { ...from, orientation: action.orientation ?? from.orientation } : null
  return { ...placeAt(state.board, from, cell), orientation: action.orientation ?? from.orientation }
}
