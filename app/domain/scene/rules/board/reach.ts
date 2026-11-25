import type { Board, Coord, SceneState, MoveAction } from '../../types'
import { coordKey, sameCell, setDistance } from './geometry'
import { getBody, getBodyAt, getFootprint, getTerrainAt, isLevelWith, sharesSpace } from './board'
import { drawsSegments, getWalkableCells, isOwnMove, type ReachableCell } from '../move'
import { getUsableCells } from '../prepared'
import { isCompelledAway } from '../stress'
import { getSidestepCells } from '../sidestep'
import { isCombinedLanding } from '../combinedMove'
import { getOpenAction } from '../log'
import { isTrampleable } from '../trample'
import { canSee, getExchanges } from '../seen'
import { getEnteringStep, getMoveOrigin, getMovePlacements } from './waypoint'

// The spaces a declared move may be taken to: all it can walk to, but for the
// reposition of a prepared defense, only those its defense can be made from,
// for an evader's step, only those off the trampler's way, and for one
// compelled to run from a caster, none nearer them, and for a move a recipe
// makes with an action, only those the recipe allows (rules/combinedMove.ts).
// What every reader of a move's reach (the board, the panel, a click) asks.
// It goes around whoever the mover could trample (`getAvoided`): the mover's
// own move comes into someone's space only by being taken to it, and goes on
// through them from there. A move something opened may not end on anyone, so
// it goes through them to the spaces it comes to no other way.
// A state is replaced, never changed, so the reach of a move in it is walked
// once, however many of them ask. `walk` is how the cells it can walk to are
// read, the table's walk unless a reader that remembers walks across states
// gives its own.
type Walk = (state: SceneState, action: MoveAction, around?: readonly string[]) => ReachableCell[]

const walked = new WeakMap<SceneState, WeakMap<MoveAction, ReachableCell[]>>()

export function getReachableCells(state: SceneState, action: MoveAction, walk: Walk = getWalkableCells): ReachableCell[] {
  const byAction = walked.get(state) ?? new WeakMap<MoveAction, ReachableCell[]>()
  walked.set(state, byAction)
  const known = byAction.get(action)
  if (known) return known
  const made = getSidestepCells(state, action, getUsableCells(state, action, walkAround(state, action, walk))).filter(({ cell }) => isCompelledAway(state, action, cell) && isCombinedLanding(state, action, cell))
  byAction.set(action, made)
  return made
}

function walkAround(state: SceneState, action: MoveAction, walk: Walk): ReachableCell[] {
  const straight = walk(state, action)
  const avoided = getAvoided(state, action, straight)
  if (avoided.length === 0) return straight
  const around = walk(state, action, avoided)
  if (isOwnMove(action)) return around
  const clear = new Set(around.map((r) => `${coordKey(r.cell)}@${r.elevation}`))
  return [...around, ...straight.filter((r) => !clear.has(`${coordKey(r.cell)}@${r.elevation}`))]
}

// The table's ruling: the way a move is taken to a space tramples nobody
// (combat.tex "Trample") who was not picked. Whom a walk goes around:
// whoever is within the furthest found and could be trampled, but for one the
// path drawn so far came into already, one whose space the mover sets out
// from, and one nobody of the mover's party knows of, whom the way around
// would give away.
function getAvoided(state: SceneState, action: MoveAction, found: readonly ReachableCell[]): string[] {
  const mover = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  if (!mover || !from || !state.board || !drawsSegments(action.movement)) return []
  const furthest = Math.max(0, ...found.map(({ steps }) => steps)) - action.path.length
  const board = state.board
  const standing = getBodyAt(mover, from)
  const setsOut = getFootprint(mover, { ...from, cell: action.path.at(-1) ?? from.cell })
  return Object.keys(state.characters).filter((id) => {
    const theirs = id !== mover.id && isTrampleable(state, id) ? getBody(state, id) : null
    return !!theirs && setDistance(theirs.footprint, setsOut) <= furthest
      && !sharesSpace(board, standing, theirs) && getEnteringStep(state, action, id) === null
      && isKnownOf(state, mover.id, id)
  })
}

// Whether the mover's party has the character in sight, or shares an exchange
// with them.
function isKnownOf(state: SceneState, moverId: string, id: string): boolean {
  const party = state.partyOf[moverId]
  const own = [moverId, ...Object.keys(state.characters).filter((m) => m !== moverId && party !== undefined && state.partyOf[m] === party)]
  return own.includes(id) || own.some((m) => canSee(state, m, id))
    || [...getExchanges(state).values()].some(({ participants }) => participants.has(id) && own.some((m) => participants.has(m)))
}

// Where a click on a character takes the move being declared: the last cell of
// its path in their space, else the cell there it comes to soonest; null when
// there is none.
export function getPickOn(state: SceneState, action: MoveAction, id: string): { cell: Coord; elevation?: number } | null {
  const theirs = id === action.actorId ? null : getBody(state, id)
  const on = (at: { cell: Coord; elevation: number }) => !!theirs && isLevelWith(theirs.feet, at.elevation) && theirs.footprint.some((t) => sameCell(t, at.cell))
  const drawn = getMovePlacements(state, action).slice(1).findLast(on)
  if (drawn) return { cell: drawn.cell }
  return getReachableCells(state, action).filter(on).reduce<ReachableCell | null>((best, r) => (best && best.steps <= r.steps ? best : r), null)
}

// Of the ways a reach comes to `cell` (once for each floor there it comes
// to), the one on the floor a click made from `height` points at: the floor
// feet at that height stand on there, the ground's for null. The shortest
// where no height is said, or none comes to that floor.
export function getReachAt<R extends Pick<ReachableCell, 'cell' | 'elevation'>>(board: Board | null, reachable: readonly R[], cell: Coord, height?: number | null): R | undefined {
  const at = reachable.filter((r) => sameCell(r.cell, cell))
  if (height === undefined || at.length < 2 || !board) return at[0]
  const floor = getTerrainAt(board, cell, height ?? 0).floor
  return at.find((r) => r.elevation === floor) ?? at[0]
}

// The same move declared twice on the same fight, once in each of two states
// that differ in nothing but the id the move was given, goes to the same
// spaces: the reach walked in one is the other's too, and is kept for it.
// Whether the two are such states.
export function shareReach(from: SceneState, onto: SceneState): boolean {
  const a = getOpenAction(from)
  const b = getOpenAction(onto)
  if (a?.kind !== 'move' || b?.kind !== 'move' || a.step !== 'define' || b.step !== 'define') return false
  // what the sequencing writes down after every press is written anew each
  // time, so it is compared by what it says, the move's id aside
  const said = (value: unknown, id: string) => JSON.stringify(value, (_, v) => {
    if (v === id) return ''
    if (v && typeof v === 'object' && !Array.isArray(v) && id in v) return Object.fromEntries(Object.entries(v).map(([k, w]) => [k === id ? '' : k, w]))
    return v
  })
  const keys = Object.keys(onto) as (keyof SceneState)[]
  if (keys.length !== Object.keys(from).length) return false
  if (keys.some((k) => k !== 'actions' && from[k] !== onto[k] && said(from[k], a.id) !== said(onto[k], b.id))) return false
  const others = (s: SceneState, id: string) => Object.keys(s.actions).filter((k) => k !== id)
  const before = others(from, a.id)
  const after = others(onto, b.id)
  if (before.length !== after.length || after.some((k) => from.actions[k] !== onto.actions[k])) return false
  if (said(a, a.id) !== said(b, b.id)) return false
  const byAction = walked.get(onto) ?? new WeakMap<MoveAction, ReachableCell[]>()
  walked.set(onto, byAction)
  if (!byAction.has(b)) byAction.set(b, getReachableCells(from, a))
  return true
}
