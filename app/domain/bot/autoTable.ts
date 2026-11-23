import type { SceneState } from '../scene/types'
import type { SceneCommand } from '../scene/commands/registry'
import { getContinueBar, getRoundPhase } from '../scene/rules/roundChange'
import { getNextRoundBar } from '../scene/rules/turn'
import { getRestAwaited } from '../scene/rules/resting'
import { getDiceBar } from '../play/calls'
import { getEndCombatBar, isOneSideLeft } from '../scene/rules/fight'

// The table's presses at a fight nobody runs as GM, by fixed rules and no
// judgement: the first round begun once everyone is placed, the round change
// moved on, the next round begun once everyone has agreed to end this one,
// and the combat ended once at most one side has anyone standing who has not
// surrendered. Asked only when no seat has anything to do; the round
// change's rest step waits for the players no seat plays as well, until they
// say they are done, and nothing is pressed while a die waits on anyone. Nothing the GM
// decides by judgement is here (pressure, breakage, an explosion of their
// own), and at a table with a GM it is never asked.

function isEveryonePlaced(state: SceneState): boolean {
  const board = state.board
  return !board || Object.keys(state.characters).every((id) => board.placements[id] !== undefined)
}

// `holdStart`: the first round waits for someone at the table to say it may
// begin (the demo's START), however ready the fight is. `players`: the
// characters no seat plays.
export function getTablePress(state: SceneState, players: readonly string[], holdStart = false): SceneCommand | null {
  if (getDiceBar(state.calls) !== null) return null
  if (state.round === 0) return !holdStart && isEveryonePlaced(state) && !isOneSideLeft(state) && getNextRoundBar(state) === null ? { kind: 'nextRound', args: [] } : null
  if (getRestAwaited(state).some((id) => players.includes(id))) return null
  if (getRoundPhase(state)) return getContinueBar(state) === null ? { kind: 'continueRound', args: [] } : null
  if (isOneSideLeft(state) && getEndCombatBar(state) === null) return { kind: 'endCombat', args: [] }
  return getNextRoundBar(state) === null ? { kind: 'nextRound', args: [] } : null
}
