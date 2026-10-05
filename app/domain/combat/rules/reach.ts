import type { CombatState, MoveAction } from '../types'
import { getWalkableCells, type ReachableCell } from './move'
import { getUsableCells } from './prepared'

// The spaces a declared move may be taken to: all it can walk to, but for the
// reposition of a prepared defense, only those its defense can be made from.
// What every reader of a move's reach (the board, the panel, a click) asks.
export function getReachableCells(state: CombatState, action: MoveAction): ReachableCell[] {
  return getUsableCells(state, action, getWalkableCells(state, action))
}
