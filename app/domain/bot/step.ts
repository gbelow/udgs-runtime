import type { CombatState } from '../combat/types'
import type { Dice } from '../combat/dice'
import { chooseAnyAnswer, chooseTurnAction } from './choose'
import { stepWith } from './engine'
import type { Party } from './party'
import type { Trace } from './trace'

// One move of the bots: the state after the next thing a character a bot
// controls owes the table, or null when there is nothing for them to do — the
// table is waiting on someone else, or the parties have nothing left to do
// this round. A bot answers, commits, rolls and lands what is its own, and
// leaves the rest to whoever owes it (instructions/combat-map.md: "An action
// waits only where someone owes a decision"). What it weighs in choosing is
// handed to `trace`.
export function stepBot(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, trace?: Trace): CombatState | null {
  return stepWith({ turn: (s, ps, party, id, d, n) => chooseTurnAction(s, ps, party, id, d, n, trace), answer: chooseAnyAnswer(trace) }, state, parties, dice, newId)
}
