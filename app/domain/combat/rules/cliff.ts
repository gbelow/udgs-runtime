import type { MoveKind } from '../../types'
import type { CombatState, Coord, MoveAction, MoveFall } from '../types'
import { CLIMB_EASY_DL, FALL } from '../../tables'
import { coordKey } from '../geometry'
import { readGround } from './ground'
import { getMoveOrigin } from './waypoint'

// Where the ground drops or rises too far to be walked: the cliffs of a move,
// the climb that crosses one, and the fall that follows a jump down or a
// climb that failed.

// combat.tex "Choosing Fall DL": the least a fall is — a metre — is the least
// of a cliff, up or down.
export function isCliff(from: number, to: number): boolean {
  return Math.abs(to - from) >= FALL.minHeight
}

// Whether a kind of movement may take a step from ground at one height to
// ground at another. A walk crosses no cliff; a jump goes up as far as it
// clears (`getJumpCeiling`) and comes down as a fall; a climb is the way over;
// a swimmer's water has its own surface.
export function canStepOver(kind: MoveKind, from: number, to: number): boolean {
  return kind === 'swim' || kind === 'jump' || kind === 'climb' || !isCliff(from, to)
}

// The height of the ground the mover sets out from and then of each cell of
// the path; null where there is no board.
export function getPathElevations(state: CombatState, action: MoveAction, path: Coord[]): number[] | null {
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  return from && ground ? [ground.elevation(from.cell), ...path.map((cell) => ground.elevation(cell))] : null
}

function hasCliff(elevations: number[]): boolean {
  return elevations.some((height, i) => i > 0 && isCliff(elevations[i - 1], height))
}

// Whether the path crosses a cliff, which a climb must.
export function crossesCliff(state: CombatState, action: MoveAction, path: Coord[]): boolean {
  const elevations = getPathElevations(state, action, path)
  return elevations !== null && hasCliff(elevations)
}

// combat.tex "Climbing": "An easy climb ... is considered a DL of 5", and "for
// every meter, the difficulty increases by 1" — the hardest ground the climb
// takes hold of (the cell's own DL, as the board paints it) and a point for
// every metre climbed after the first.
export function getClimbDL(state: CombatState, action: MoveAction): number {
  const elevations = getPathElevations(state, action, action.path)
  const board = state.board
  if (!elevations || !board) return CLIMB_EASY_DL
  const gripped = action.path.filter((_, i) => isCliff(elevations[i], elevations[i + 1]))
  const metres = elevations.reduce((sum, height, i) => (i > 0 ? sum + Math.abs(height - elevations[i - 1]) : sum), 0)
  const hardest = Math.max(CLIMB_EASY_DL, ...gripped.map((cell) => board.terrain[coordKey(cell)]?.DL ?? CLIMB_EASY_DL))
  return hardest + Math.max(0, metres - 1)
}

// combat.tex "Climbing": "On a failure, the character simply falls from the
// surface" — the table's ruling is from the highest point the climb reached,
// to the lower of where it began and where it was bound; null where that is
// no fall at all.
function getClimbFall(state: CombatState, action: MoveAction, path: Coord[]): MoveFall | null {
  const elevations = getPathElevations(state, action, path)
  const origin = getMoveOrigin(state, action)
  if (!elevations || !origin) return null
  const last = elevations.length - 1
  const landsAtEnd = elevations[last] < elevations[0]
  const height = Math.max(...elevations) - elevations[landsAtEnd ? last : 0]
  return height >= FALL.minHeight ? { height, to: landsAtEnd ? path[path.length - 1] : origin.cell } : null
}

// combat.tex "Fall skill test": a jump that comes down on lower ground lands
// from the height it came down.
function getJumpFall(state: CombatState, action: MoveAction, path: Coord[]): MoveFall | null {
  const elevations = getPathElevations(state, action, path)
  if (!elevations || path.length === 0) return null
  const height = elevations[0] - elevations[elevations.length - 1]
  return height >= FALL.minHeight ? { height, to: null } : null
}

// The fall a move as walked ends in, if any.
export function getMoveFall(state: CombatState, action: MoveAction, path: Coord[]): MoveFall | null {
  if (action.movement === 'jump') return getJumpFall(state, action, path)
  if (action.movement === 'climb' && action.roll?.degree === 'miss') return getClimbFall(state, action, path)
  return null
}
