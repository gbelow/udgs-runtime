import type { SceneState, RootAction } from '../types'
import { getCarriedMove, type ReactionMove } from './reactionMoves'
import { getPassedUp, getSpawned } from './log'
import { isInTurn } from './turn'
import { getRolledMoveAP } from './carriedMove'

// The careful move a rolled action carries (rules/carriedMove.ts: a rest, a
// cast rested through), in the actor's own turn: theirs
// to make or not, once, while the action waits to land. It is played out
// before the action's effects, a spell's among them.
export function canMoveWhileResting(state: SceneState, root: RootAction): boolean {
  return root.step === 'post' && getRolledMoveAP(state, root) > 0 && isInTurn(state, root.actorId) && state.board?.placements[root.actorId] !== undefined
    && !hasRestMove(state, root.id)
}

export function hasRestMove(state: SceneState, rootId: string): boolean {
  return [...getSpawned(state, rootId), ...getPassedUp(state, rootId)].some((a) => a.kind === 'move')
}

// The move the action allows: careful only, as far as its AP reaches, which
// have already paid for it.
export function getRestMove(state: SceneState, root: RootAction): ReactionMove {
  return getCarriedMove(getRolledMoveAP(state, root))
}
