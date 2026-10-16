import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { getAwaited } from '../scene/rules/options'
import { commitAction, resolveAction, rollOrPay } from '../scene/commands/action'
import { answerOpen } from './answer'
import { findParty, type Party } from './party'
import { passUp, tableMove } from './table'

// What a bot owes the action being played out, and the playing out of one.

// How the parties answer the committed action: the new state with one
// declared, or null.
export type Answerer = (state: SceneState, parties: readonly Party[], open: RootAction, newId: () => string) => SceneState | null

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

export function stepOpen(state: SceneState, parties: readonly Party[], open: RootAction, dice: Dice, newId: () => string, answer: Answerer): SceneState | null {
  const owner = findParty(parties, open.actorId)
  switch (open.step) {
    case 'define':
      return owner ? settleDeclared(state, open, dice, newId) : null
    case 'react':
      return answer(state, parties, open, newId) ?? (owner && !isAnswerOwed(state, parties) ? rollOrPay(dice, newId)(state) : null)
    case 'post':
      return owner ? resolveAction(newId)(state) : null
    case 'done':
    case 'held':
      return null
  }
}

// What a bot finds still declared and not committed: taken to its commit, or
// passed up.
function settleDeclared(state: SceneState, open: RootAction, dice: Dice, newId: () => string): SceneState {
  if (open.spawnedBy) return passUp(state, open, newId)
  const committed = commitAction(dice, newId)(state)
  return committed !== state ? committed : passUp(state, open, newId)
}

// Whether the committed action still waits on anyone no bot controls
// (`getAwaited`): the die waits for them, and for whoever presses it.
function isAnswerOwed(state: SceneState, parties: readonly Party[]): boolean {
  return getAwaited(state).some((id) => !findParty(parties, id))
}

// The open action played to its end, everyone answering by reflex bar `skip`,
// the table pressing what nobody owes. For trying an option out on a copy.
export function playOut(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string, skip: readonly string[] = []): SceneState {
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
