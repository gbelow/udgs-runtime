import type { CombatState, RootAction } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getOpenAction } from '../combat/rules/log'
import { hasOpenAnswer } from '../combat/rules/options'
import { commitAction, resolveAction, rollOrPay } from '../combat/commands/action'
import { answerOpen } from './answer'
import { findParty, type Party } from './party'
import { passUp, tableMove } from './table'

// What a bot owes the action being played out, and the playing out of one.

// How the parties answer the committed action: the new state with one
// declared, or null.
export type Answerer = (state: CombatState, parties: readonly Party[], open: RootAction, newId: () => string) => CombatState | null

// The cheapest defense, unweighed, from everyone but those named.
export function reflexAnswer(skip: readonly string[] = []): Answerer {
  return (state, parties, open, newId) => {
    for (const party of parties) {
      const answered = answerOpen(state, party, open, newId, skip)
      if (answered) return answered
    }
    return null
  }
}

export function stepOpen(state: CombatState, parties: readonly Party[], open: RootAction, dice: Dice, newId: () => string, answer: Answerer): CombatState | null {
  const owner = findParty(parties, open.actorId)
  switch (open.step) {
    case 'define':
      return owner ? settleDeclared(state, open, dice, newId) : null
    case 'react':
      return answer(state, parties, open, newId) ?? (owner && !isAnswerOwed(state, parties) ? rollOrPay(dice, newId)(state) : null)
    case 'post':
      return owner ? resolveAction(newId)(state) : null
    case 'done':
      return null
  }
}

// What a bot finds still declared and not committed: taken to its commit, or
// passed up.
function settleDeclared(state: CombatState, open: RootAction, dice: Dice, newId: () => string): CombatState {
  if (open.spawnedBy) return passUp(state, open, newId)
  const committed = commitAction(dice, newId)(state)
  return committed !== state ? committed : passUp(state, open, newId)
}

// Whether anyone no bot controls has an answer open to the committed action:
// the die waits for them, and for whoever presses it.
function isAnswerOwed(state: CombatState, parties: readonly Party[]): boolean {
  return hasOpenAnswer(state, Object.keys(state.characters).filter((id) => !findParty(parties, id)))
}

// The open action played to its end, everyone answering by reflex bar `skip`,
// the table pressing what nobody owes. For trying an option out on a copy.
export function playOut(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, skip: readonly string[] = []): CombatState {
  let current = state
  for (let i = 0; i < 30; i++) {
    const open = getOpenAction(current)
    if (!open) return current
    const next = stepOpen(current, parties, open, dice, newId, reflexAnswer(skip)) ?? tableMove(current, parties, dice, newId)
    if (!next || next === current) return current
    current = next
  }
  return current
}
