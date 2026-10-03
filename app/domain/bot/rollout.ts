import type { CombatState } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getNextRoundBar } from '../combat/rules/turn'
import { nextRound } from '../combat/commands/nextRound'
import { stepWith } from './engine'
import { GREEDY } from './greedy'
import { getLiveFoes, type Party } from './party'
import { tableMove } from './table'

// The fight played on from a state by the greedy bot on every side, for a
// number of rounds counting the one it is in: 1 plays out what is left of this
// round. It stops sooner when a side has no foe left, or the round cannot pass.

const STEPS = 400

export function rollout(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, rounds: number): CombatState {
  const until = state.round + rounds
  let current = state
  for (let i = 0; i < STEPS; i++) {
    const next = stepWith(GREEDY, current, parties, dice, newId) ?? tableMove(current, parties, dice, newId)
    if (next) {
      current = next
      continue
    }
    if (parties.some((p) => getLiveFoes(current, p).length === 0) || getNextRoundBar(current) !== null || current.round + 1 >= until) return current
    current = nextRound(dice, newId)(current)
  }
  return current
}
