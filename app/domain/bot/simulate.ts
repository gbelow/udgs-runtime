import type { ActionKind, CombatState } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getAction } from '../combat/rules/log'
import { getNextRoundBar } from '../combat/rules/turn'
import { nextRound } from '../combat/commands/nextRound'
import { getActionReport, type ActionReport } from '../combat/projections/outcomes'
import { getLiveFoes, isStanding, type Party } from './party'
import { stepBot } from './step'
import { tableMove } from './table'

// A fight played out by the bots alone, with the table played by `tableMove`
// for the characters no bot controls: they answer nothing and take no turn.

export type LoggedAction = {
  round: number
  actorId: string
  kind: ActionKind
  report: ActionReport
}

// `won`: a party has no foe left standing (`winner` is its index in `parties`,
// null when both sides fell); `round cap`: still going after `maxRounds`;
// `stalled`: the round cannot pass and nobody has a move.
export type Ending = 'won' | 'round cap' | 'stalled'

export type Simulation = {
  final: CombatState
  rounds: number
  ending: Ending
  winner: number | null
  // what the round was waiting on, when `stalled`
  stalledOn: string | null
  log: LoggedAction[]
}

const STEPS_PER_ROUND = 500

export function simulate(initial: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, maxRounds = 20): Simulation {
  let state = initial
  const log: LoggedAction[] = []
  const end = (rounds: number, ending: Ending, winner: number | null = null, stalledOn: string | null = null): Simulation => ({ final: state, rounds, ending, winner, stalledOn, log })

  for (let round = 1; round <= maxRounds; round++) {
    for (let i = 0; i < STEPS_PER_ROUND; i++) {
      const next = stepBot(state, parties, dice, newId) ?? tableMove(state, parties, dice, newId)
      if (!next) break
      for (const id of next.history.slice(state.history.length)) {
        const action = getAction(next, id)
        const report = getActionReport(next, id)
        if (action && report) log.push({ round, actorId: action.actorId, kind: action.kind, report })
      }
      state = next
    }
    if (parties.some((p) => getLiveFoes(state, p).length === 0)) return end(round, 'won', getWinner(state, parties))
    const bar = getNextRoundBar(state)
    if (bar !== null) return end(round, 'stalled', null, bar)
    state = nextRound(dice, newId)(state)
  }
  return end(maxRounds, 'round cap')
}

function getWinner(state: CombatState, parties: readonly Party[]): number | null {
  const index = parties.findIndex((p) => getLiveFoes(state, p).length === 0 && p.members.some((id) => isStanding(state, id)))
  return index >= 0 ? index : null
}
