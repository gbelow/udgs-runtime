import type { MoveAction, SceneState } from '../types'
import { perPair } from '../../perState'
import { isDead } from '../../character/rules/afflictions'
import { getMovePlacements, getMoveWaypoint } from './board/waypoint'
import { withPlacements } from './board/board'
import { sameCell } from './board/geometry'
import { getFreeStep, getWalkedPath, isStoppableAt } from './move'
import { notices } from './stealth'

// The user's ruling (2026-11-26): a mover who comes to notice someone they
// did not as they set out may stop there, go on, or go on whoever they notice
// next. "Someone" is anyone alive outside the mover's party, noticed as the
// mover would from that step of the path, everyone else standing where they
// stand. A stop is offered only where the move may stop (`isStoppableAt`: no
// jump, a run only inside its first 2 AP) and short of the path's end.

export type Sighting = { step: number; ids: string[] }

// Every step of the path at which the mover first notices someone, in path
// order, with whom; whether the move may stop there is left to the reader.
export const getSightings = perPair<Sighting[], SceneState, MoveAction>(({ a: state, b: move }) => {
  const board = state.board
  const placements = getMovePlacements(state, move)
  if (!board || placements.length < 2) return []
  const party = state.partyOf[move.actorId]
  const others = Object.keys(board.placements).filter((id) => {
    const c = state.characters[id]
    return id !== move.actorId && !!c && !isDead(c) && (party === undefined || state.partyOf[id] !== party)
  })
  const at = (step: number): SceneState => ({ ...state, board: { ...board, placements: { ...board.placements, [move.actorId]: placements[step] } } })
  const noticedAt = (step: number) => others.filter((id) => notices(at(step), move.actorId, id))
  const seen = new Set(noticedAt(0))
  const out: Sighting[] = []
  for (let step = 1; step < placements.length; step++) {
    const fresh = noticedAt(step).filter((id) => !seen.has(id))
    fresh.forEach((id) => seen.add(id))
    if (fresh.length > 0) out.push({ step, ids: fresh })
  }
  return out
})

// The sighting the rolled move waits on its mover's choice for: the first
// past the last one they went on past, at a step the move may stop at and
// short of where it now ends. Null once they have stopped or chosen to go on
// regardless, or for a move not waiting at `post`.
export function getPendingSighting(state: SceneState, move: MoveAction): Sighting | null {
  if (move.step !== 'post' || move.stoppedAt !== null || move.regardless) return null
  const walked = getWalkedPath(state, move).path.length
  return getSightings(state, move).find((s) => s.step > move.goneOn && s.step < walked && isStoppableAt(state, move, s.step)) ?? null
}

// Whether a reaction firing at step `at` of the move waits for its mover to
// decide on a sighting they make before it.
export function isSightingBefore(state: SceneState, move: MoveAction, at: number | null): boolean {
  const pending = getPendingSighting(state, move)
  return pending !== null && at !== null && pending.step < at
}

// The fight as it stands while the mover decides on the sighting their move
// waits on: stood at that step, or short of whoever's space they were passing
// through there (`getFreeStep`), as an opportunity attack has them, so that
// they, and the board, see what they came to notice. Unchanged with nothing
// to decide or with the mover stood there already.
export function getSightingState(state: SceneState, move: MoveAction): SceneState {
  const pending = getPendingSighting(state, move)
  const waypoint = pending ? getMoveWaypoint(state, move, getFreeStep(state, move, pending.step)) : null
  const standing = state.board?.placements[move.actorId]
  if (!waypoint || (standing && sameCell(standing.cell, waypoint.cell) && standing.elevation === waypoint.elevation && standing.orientation === waypoint.orientation)) return state
  return withPlacements(state, { [move.actorId]: waypoint })
}
