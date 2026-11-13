import type { SceneState, MoveAction } from '../../types'
import { getWalkableCells, type ReachableCell } from '../move'
import { getUsableCells } from '../prepared'
import { isCompelledAway } from '../stress'
import { getSidestepCells } from '../sidestep'
import { isCombinedLanding } from '../combinedMove'
import { perPair } from '../../../perState'

// The spaces a declared move may be taken to: all it can walk to, but for the
// reposition of a prepared defense, only those its defense can be made from,
// for an evader's step, only those off the trampler's way, and for one
// compelled to run from a caster, none nearer them, and for a move a recipe
// makes with an action, only those the recipe allows (rules/combinedMove.ts).
// What every reader of a move's reach (the board, the panel, a click) asks.
// A state is replaced, never changed, so the reach of a move in it is walked
// once, however many of them ask.
export const getReachableCells: (state: SceneState, action: MoveAction) => ReachableCell[] = perPair(({ a: state, b: action }) =>
  getSidestepCells(state, action, getUsableCells(state, action, getWalkableCells(state, action))).filter(({ cell }) => isCompelledAway(state, action, cell) && isCombinedLanding(state, action, cell)))
