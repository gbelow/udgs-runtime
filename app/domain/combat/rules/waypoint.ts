import type { CombatState, Coord, MoveAction, Placement } from '../types'
import { setDistance } from '../geometry'
import { getFootprint, getPlacedFootprint, placeAt } from './board'

// Where the mover stands along a move: where it sets out from, each step of
// the path, and where it ends.

// Where the move sets out from: the placement the commit wrote down, or
// while it is still being declared, where the actor stands.
export function getMoveOrigin(state: CombatState, action: MoveAction): Placement | undefined {
  return action.from ?? state.board?.placements[action.actorId]
}

// Where the mover stands part of the way along the move: the anchor at that
// step, as oriented when they set out. Null at step 0, where they have not
// left the origin.
export function getMoveWaypoint(state: CombatState, action: MoveAction, steps: number): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = action.path[steps - 1]
  if (!from || !cell || steps <= 0) return null
  return placeAt(state.board, from, cell)
}

// Where the mover stands either side of the step into the `at`th cell of
// the move: before it, at the origin for the first step.
export function getStepPlacements(state: CombatState, action: MoveAction, at: number): { before: Placement; after: Placement } | null {
  const before = at <= 1 ? getMoveOrigin(state, action) : getMoveWaypoint(state, action, at - 1)
  const after = getMoveWaypoint(state, action, at)
  return before && after ? { before, after } : null
}

// How the step into the `at`th cell of the move changes the mover's distance
// to someone: below zero towards them, above away from them.
export function getStepDelta(state: CombatState, action: MoveAction, at: number, otherId: string): number | null {
  const mover = state.characters[action.actorId]
  const other = getPlacedFootprint(state, otherId)
  const step = getStepPlacements(state, action, at)
  if (!mover || !other || !step) return null
  return setDistance(getFootprint(mover, step.after), other) - setDistance(getFootprint(mover, step.before), other)
}

// combat.tex "Hook Attack": a runner stepping away from the attacker (the
// step the hook's reaction fires on).
export function isHookedRunner(state: CombatState, action: MoveAction, at: number, attackerId: string): boolean {
  return action.movement === 'run' && (getStepDelta(state, action, at, attackerId) ?? 0) > 0
}

// Where the move ends: the last cell of the path as walked, the orientation
// it named, the elevation of the ground there — the board's terrain says how
// high a cell is, so a placement carried in from a VTT is re-read off it on
// the first move.
export function getMoveDestination(state: CombatState, action: MoveAction, path: Coord[]): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = path[path.length - 1]
  if (!from || !cell) return null
  return { ...placeAt(state.board, from, cell), orientation: action.orientation ?? from.orientation }
}
