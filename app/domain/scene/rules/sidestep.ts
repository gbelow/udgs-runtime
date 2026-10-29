import type { ActionOf, Coord, MoveAction, Placement, RootAction, SceneState } from '../types'
import { makeAction } from '../factories'
import { directionTo } from './board/geometry'
import { getFootprint, getPlacedFootprint, withoutPlacements } from './board/board'
import { isWet, readGround } from './board/ground'
import { getEnteringStep, getMoveDestination, getStepPlacements } from './board/waypoint'
import { getAction, getPassedUp, getReactionsTo, getRootOf, getSpawned } from './log'
import { getMoveFacts, getMovementOptions, getWalkableCells } from './move'
import { getSidestepMove } from './reactionMoves'
import { isCampaignCharacter } from '../../utils'

// combat.tex "Trample": "Evades: costs 2 AP to allow free passage ... This
// allows 1 basic movement in any direction that does not coincide with the
// trampler." The table's rulings: the step is the evader's, bought with the
// evade's AP, taken before the trample lands, in any direction but the one the
// mover is heading in as they come into the evader's space, on ground as high
// as the evader's and out of the water; it draws opportunity attacks. It may
// be passed up, unless the mover ends in the evader's space: then it is
// forced, and one with nowhere to step cannot evade. While it is taken the
// mover is off the board, passing through, so the evader may step where the
// mover stood.

// The evade that opened the move, with the trample it answers; null for any
// other move.
export function getSidestepOf(state: SceneState, move: MoveAction): { evade: ActionOf<'evade'>; root: MoveAction } | null {
  const evade = move.spawnedBy ? getAction(state, move.spawnedBy) : null
  if (evade?.kind !== 'evade') return null
  const root = getRootOf(state, evade)
  return root?.kind === 'move' ? { evade, root } : null
}

// Whether the move, as declared, comes to rest in the character's space.
export function isEndingOn(state: SceneState, root: MoveAction, id: string): boolean {
  const mover = state.characters[root.actorId]
  const end = getMoveDestination(state, root, root.path)
  const theirs = getPlacedFootprint(state, id)
  if (!mover || !end || !theirs || root.path.length === 0) return false
  return getFootprint(mover, end).some((f) => theirs.some((t) => f.q === t.q && f.r === t.r))
}

// The fight as the evader steps: the mover off the board, passing through.
export function getSidestepState(state: SceneState, root: MoveAction): SceneState {
  return withoutPlacements(state, [root.actorId])
}

// Where the mover stood before an evader's step, taken or passed up, took them
// off the board; null for one no step did.
export function getPassingPlacement(state: SceneState, root: MoveAction): Placement | null {
  for (const reaction of getReactionsTo(state, root.id)) {
    const step = [...getSpawned(state, reaction.id), ...getPassedUp(state, reaction.id)].find((a): a is MoveAction => a.kind === 'move' && a.passing !== null)
    if (step) return step.passing
  }
  return null
}

// Whether the move, as it will be walked, comes into the evader's space: one
// stopped before it (an opportunity attack, a flee, a crash, a fall) never
// does. Read with the evader off the board, since they will have stepped
// out of the space the move may end in.
export function isSidestepReached(state: SceneState, root: MoveAction, id: string): boolean {
  const at = getEnteringStep(state, root, id)
  return at !== null && at <= getMoveFacts(withoutPlacements(state, [id]), root).path.length
}

// Whether the evader's path keeps off the way the mover is heading as it comes
// into their space, on ground as high as where they stand, out of the water.
export function isSidestepPath(state: SceneState, root: MoveAction, id: string, path: Coord[]): boolean {
  const at = getEnteringStep(state, root, id)
  const step = at === null ? null : getStepPlacements(state, root, at)
  const c = state.characters[id]
  const from = state.board?.placements[id]
  const floor = from && readGround(state, id)?.at(from.elevation)
  if (!step || !c || !from || !floor) return false
  const heading = directionTo(step.before.cell, step.after.cell)
  const height = floor.elevation(from.cell)
  return path.every((cell, i) =>
    directionTo(i === 0 ? from.cell : path[i - 1], cell) !== heading && floor.elevation(cell) === height && !isWet(getFootprint(c, { ...from, cell }), floor))
}

// Of the spaces a move can reach, those a sidestep may go to; every other
// move may go anywhere it reaches.
export function getSidestepCells<C extends { path: Coord[] }>(state: SceneState, move: MoveAction, cells: C[]): C[] {
  const sidestep = getSidestepOf(state, move)
  return sidestep ? cells.filter(({ path }) => isSidestepPath(state, sidestep.root, move.actorId, path)) : cells
}

// Whether a move ends where its sidestep may take it; any other move is not one.
export function isSidestepPlaced(state: SceneState, move: MoveAction): boolean {
  const sidestep = getSidestepOf(state, move)
  return !sidestep || isSidestepPath(state, sidestep.root, move.actorId, move.path)
}

// The step the evade opens, the fight it is taken in, or null when it has
// nowhere to go.
export function openSidestep(state: SceneState, root: MoveAction, reaction: ActionOf<'evade'>, id: string): { state: SceneState; action: MoveAction } | null {
  const evader = state.characters[reaction.actorId]
  if (!evader) return null
  const placed = getSidestepState(state, root)
  const passing = state.board?.placements[root.actorId] ?? null
  const action = makeAction('move', { ...getSidestepMove(evader, reaction.cost?.AP ?? 0, isEndingOn(state, root, reaction.actorId)), id, actorId: reaction.actorId, spawnedBy: reaction.id, passing })
  return hasSidestep(placed, root, action) ? { state: placed, action } : null
}

function hasSidestep(placed: SceneState, root: MoveAction, step: MoveAction): boolean {
  return getWalkableCells(placed, step).some(({ path }) => isSidestepPath(placed, root, step.actorId, path))
}

// Why the one the trample comes into cannot evade it, paying `paid` AP: the
// mover ends in their space and they have no step to take out of it, so it is
// a crash. Null when they can.
export function getSidestepBar(state: SceneState, root: RootAction, id: string, paid: number): string | null {
  const c = state.characters[id]
  if (root.kind !== 'move' || !c || !isCampaignCharacter(c) || !state.board || !isEndingOn(state, root, id)) return null
  const placed = getSidestepState(state, root)
  const step = makeAction('move', { ...getSidestepMove(c, paid, true), id: '', actorId: id })
  const basic = getMovementOptions(placed, c, step).find((o) => o.kind === 'basic')
  if (!basic?.available) return `the mover ends here, and ${basic?.reason ?? 'no step can be taken'}`
  return hasSidestep(placed, root, step) ? null : 'the mover ends here, and there is nowhere to step aside to'
}
