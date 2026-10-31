import type { MoveAction, SceneState, ShootAction } from '../types'
import { makeAction } from '../factories'
import { withPlacements } from './board/board'
import { getMoveWaypoint } from './board/waypoint'
import { isPathLegal } from './move'
import { getCarriedMove } from './reactionMoves'
import { getCarriedOf, getDeclaredMoveAP } from './carriedMove'

// abilities.tex "Steady Arms": "It is considered that the attack came from
// any position that the attacker has been. Opportunity attacks are triggered
// at all positions along the path." The careful path is declared with the
// shot, and so is the step it is fired from (the table's ruling). The steps
// before it are walked first, as a move of its own that draws its own
// opportunity attacks, and the shot is made from where they end; the steps
// after it are walked once the shot has landed. Both are bought with the
// shot's AP (rules/carriedMove.ts).

// Whether the shot is declared as made on the move.
export function isSteadyShot(state: SceneState, shot: ShootAction): boolean {
  return getCarriedOf(state.characters[shot.actorId], shot) !== null
}

// The careful move the whole path is, as the board draws and checks it.
export function getSteadyPath(state: SceneState, shot: ShootAction): MoveAction {
  const AP = getDeclaredMoveAP(state, shot)
  return makeAction('move', { id: '', actorId: shot.actorId, path: shot.path, turns: shot.turns, ...getCarriedMove(AP) })
}

// How many steps of the path are walked before the shot is fired.
export function getFiringStep(shot: ShootAction): number {
  return Math.min(shot.firedAt ?? shot.path.length, shot.path.length)
}

// Every step of the path the shot may be fired from, the start included, and
// the one it is.
export function getFiringSteps(shot: ShootAction): { at: number; selected: boolean }[] {
  const picked = getFiringStep(shot)
  return Array.from({ length: shot.path.length + 1 }, (_, at) => ({ at, selected: at === picked }))
}

// Whether the path declared is one the shooter may walk while shooting.
export function isSteadyPathLegal(state: SceneState, shot: ShootAction): boolean {
  return !isSteadyShot(state, shot) || shot.path.length === 0 || isPathLegal(state, getSteadyPath(state, shot))
}

// The fight as the shot is declared from the step it is fired from: the
// shooter stood there, to see what they can aim at and at what penalty.
export function getFiringState(state: SceneState, shot: ShootAction): SceneState {
  if (!isSteadyShot(state, shot) || shot.step !== 'define') return state
  const waypoint = getMoveWaypoint(state, getSteadyPath(state, shot), getFiringStep(shot))
  return waypoint ? withPlacements(state, { [shot.actorId]: waypoint }) : state
}

export type SteadyLeg = 'before' | 'after'

// The move that walks the path before the shot is fired or after it, null
// when there is no step to walk.
export function openSteadyLeg(state: SceneState, shot: ShootAction, leg: SteadyLeg, id: string): MoveAction | null {
  if (!isSteadyShot(state, shot)) return null
  const at = getFiringStep(shot)
  const walked = leg === 'before'
    ? { path: shot.path.slice(0, at), turns: shot.turns.filter((t) => t > 0 && t < at) }
    : { path: shot.path.slice(at), turns: shot.turns.filter((t) => t > at).map((t) => t - at) }
  if (walked.path.length === 0) return null
  return makeAction('move', { id, actorId: shot.actorId, spawnedBy: shot.id, ...walked, ...getCarriedMove(getDeclaredMoveAP(state, shot)) })
}
