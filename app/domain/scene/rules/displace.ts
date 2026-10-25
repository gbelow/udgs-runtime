import type { Coord, MoveAction, Placement, SceneState } from '../types'
import { makeAction } from '../factories'
import { coordKey, ring } from './board/geometry'
import { getFootprint, placeAt, withPlacements } from './board/board'
import { canRest, isWet, readGround } from './board/ground'
import { getMoveDestination, getMoveOrigin, getMoveSweep } from './board/waypoint'
import { getSpawned } from './log'
import { getWalkedPath } from './move'
import { isImmobile } from './situational'
import { isInGrapple } from './partners'

// combat.tex "Crash": "If the attacker ends their movement in the same space
// as its target and wins, the defender is displaced by 1 space." The table's
// rulings: a winner who passes on a difference under 5 has won too; the
// attacker picks the space once the crash is known, one next to the
// defender's, off the attacker's way, on ground as high as the defender's and
// out of the water; with nowhere to put any of them, nobody is displaced and
// the attacker stops short. The displacement is a movement forced on the
// defender, made before the attacker comes to rest: it draws opportunity
// attacks, costs nothing, and an interruption does not cancel it.

export type Displacement = MoveAction['displaced'][number]

// Where the defender stood when the crash was fought.
function getStoodAt(state: SceneState, move: MoveAction, id: string): Placement | undefined {
  return move.displaced.find((d) => d.id === id)?.from ?? state.board?.placements[id]
}

// Whoever the move, walked the whole way it was declared, comes to rest on and
// passed in a crash.
export function getCrashedAtEnd(state: SceneState, move: MoveAction): string[] {
  const mover = state.characters[move.actorId]
  const end = getMoveDestination(state, move, move.path)
  if (!mover || !end || move.path.length === 0) return []
  const footprint = getFootprint(mover, end).map(coordKey)
  const there = Object.keys(state.characters).filter((id) => {
    const other = state.characters[id]
    const at = id === move.actorId ? undefined : getStoodAt(state, move, id)
    return other && at && getFootprint(other, at).some((cell) => footprint.includes(coordKey(cell)))
  })
  if (there.length === 0) return []
  const walked = getWalkedPath(state, move)
  if (walked.stop !== 'end' || walked.path.length !== move.path.length) return []
  return walked.tramples.trampled.flatMap((t) => (t.result === 'passed' && there.includes(t.id) ? [t.id] : []))
}

// The spaces the attacker may put the defender in: next to where they stood,
// off every space the attacker's way takes them over, as high, dry, and free
// to rest on with the attacker at the end and the others put where they are
// picked to go. None for one hanging, grappled or immobile.
export function getDisplacementCells(state: SceneState, move: MoveAction, id: string): Coord[] {
  const c = state.characters[id]
  const mover = state.characters[move.actorId]
  const from = getStoodAt(state, move, id)
  const origin = getMoveOrigin(state, move)
  const end = getMoveDestination(state, move, move.path)
  if (!c || !mover || !from || !origin || !end || !state.board || from.climb || isImmobile(state, c) || isInGrapple(state, id)) return []
  const board = state.board
  const landing: Record<string, Placement> = { [move.actorId]: end }
  for (const d of move.displaced) if (d.id !== id) landing[d.id] = placeAt(board, d.from, d.to)
  const ground = readGround(state, id, landing)
  if (!ground) return []
  const way = new Set([getFootprint(mover, origin), ...getMoveSweep(state, move)].flat().map(coordKey))
  const height = ground.elevation(from.cell)
  return ring(from.cell, 1).filter((cell) => {
    const footprint = getFootprint(c, placeAt(board, from, cell))
    return !footprint.some((f) => way.has(coordKey(f))) && ground.elevation(cell) === height && !footprint.some(ground.blocked) && !isWet(footprint, ground) && canRest(state, c, footprint, ground, false)
  })
}

// Whether everyone the move ends on has somewhere to be put, so the
// displacement is made at all.
function canDisplaceAll(state: SceneState, move: MoveAction, crashed: string[]): boolean {
  return crashed.length > 0 && crashed.every((id) => move.displaced.some((d) => d.id === id) || getDisplacementCells(state, move, id).length > 0)
}

// The next defender the attacker has yet to pick a space for; null when there
// is none, or when someone has nowhere to go and nobody is displaced.
export function getPendingDisplacement(state: SceneState, move: MoveAction): string | null {
  if (move.step !== 'post' || getDisplacementMoves(state, move).length > 0) return null
  const crashed = getCrashedAtEnd(state, move)
  if (!canDisplaceAll(state, move, crashed)) return null
  return crashed.find((id) => !move.displaced.some((d) => d.id === id)) ?? null
}

// The forced movements the move has opened for its displacements.
function getDisplacementMoves(state: SceneState, move: MoveAction): MoveAction[] {
  return getSpawned(state, move.id).filter((a): a is MoveAction => a.kind === 'move' && a.forced)
}

// The fight with the picks not yet made into a movement read where they put
// their defender: what the attacker comes to rest against.
export function withDisplaced(state: SceneState, move: MoveAction): SceneState {
  if (move.displaced.length === 0 || !state.board) return state
  const moved = new Set(getDisplacementMoves(state, move).map((a) => a.actorId))
  const board = state.board
  const pending = move.displaced.filter((d) => !moved.has(d.id))
  return pending.length > 0 ? withPlacements(state, Object.fromEntries(pending.map((d) => [d.id, placeAt(board, d.from, d.to)]))) : state
}

// The next displacement to be made, as the forced movement of its defender,
// committed as it opens; null once every pick has been made into one, or when
// one picked can no longer go where it was picked to, which leaves the rest
// where they stand and the attacker short of them.
export function getNextDisplacement(state: SceneState, move: MoveAction, newId: () => string): MoveAction | null {
  const crashed = getCrashedAtEnd(state, move)
  if (crashed.length === 0 || !crashed.every((c) => move.displaced.some((d) => d.id === c))) return null
  const moved = new Set(getDisplacementMoves(state, move).map((a) => a.actorId))
  const next = move.displaced.find((d) => !moved.has(d.id))
  if (!next) return null
  if (!getDisplacementCells(state, move, next.id).some((cell) => cell.q === next.to.q && cell.r === next.to.r)) return null
  return makeAction('move', { id: newId(), actorId: next.id, spawnedBy: move.id, movement: 'basic', movements: ['basic'], path: [next.to], from: next.from, forced: true, step: 'react' })
}
