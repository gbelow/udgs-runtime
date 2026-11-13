import type { SceneState } from '../scene/types'
import type { SceneCommand } from '../scene/commands/registry'
import { getContinueBar, getRoundPhase } from '../scene/rules/roundChange'
import { getNextRoundBar } from '../scene/rules/turn'
import { getEndCombatBar } from '../scene/rules/fight'
import { isDown } from './table'

// The table's presses at a fight nobody runs as GM, by fixed rules and no
// judgement: the first round begun once everyone is placed, the round change
// moved on, the next round begun once everyone has agreed to end this one,
// and the combat ended once at most one side has anyone standing who has not
// surrendered. Asked only when no seat has anything to do. Nothing the GM
// decides by judgement is here (pressure, breakage, an explosion of their
// own), and at a table with a GM it is never asked.

export function isOneSideLeft(state: SceneState): boolean {
  const standing = Object.keys(state.characters).filter((id) => !isDown(state, id) && !state.surrendered.includes(id))
  return new Set(standing.map((id) => state.partyOf[id] ?? '')).size <= 1
}

function isEveryonePlaced(state: SceneState): boolean {
  const board = state.board
  return !board || Object.keys(state.characters).every((id) => board.placements[id] !== undefined)
}

export function getTablePress(state: SceneState): SceneCommand | null {
  if (state.round === 0) return isEveryonePlaced(state) && !isOneSideLeft(state) && getNextRoundBar(state) === null ? { kind: 'nextRound', args: [] } : null
  if (getRoundPhase(state)) return getContinueBar(state) === null ? { kind: 'continueRound', args: [] } : null
  if (isOneSideLeft(state) && getEndCombatBar(state) === null) return { kind: 'endCombat', args: [] }
  return getNextRoundBar(state) === null ? { kind: 'nextRound', args: [] } : null
}
