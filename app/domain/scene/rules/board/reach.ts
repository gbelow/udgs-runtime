import type { SceneState, MoveAction } from '../../types'
import { getWalkableCells, type ReachableCell } from '../move'
import { getUsableCells } from '../prepared'
import { isCompelledAway } from '../stress'
import { getSidestepCells } from '../sidestep'
import { isCombinedLanding } from '../combinedMove'
import { getOpenAction } from '../log'

// The spaces a declared move may be taken to: all it can walk to, but for the
// reposition of a prepared defense, only those its defense can be made from,
// for an evader's step, only those off the trampler's way, and for one
// compelled to run from a caster, none nearer them, and for a move a recipe
// makes with an action, only those the recipe allows (rules/combinedMove.ts).
// What every reader of a move's reach (the board, the panel, a click) asks.
// A state is replaced, never changed, so the reach of a move in it is walked
// once, however many of them ask.
const walked = new WeakMap<SceneState, WeakMap<MoveAction, ReachableCell[]>>()

export function getReachableCells(state: SceneState, action: MoveAction): ReachableCell[] {
  const byAction = walked.get(state) ?? new WeakMap<MoveAction, ReachableCell[]>()
  walked.set(state, byAction)
  const known = byAction.get(action)
  if (known) return known
  const made = getSidestepCells(state, action, getUsableCells(state, action, getWalkableCells(state, action))).filter(({ cell }) => isCompelledAway(state, action, cell) && isCombinedLanding(state, action, cell))
  byAction.set(action, made)
  return made
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
