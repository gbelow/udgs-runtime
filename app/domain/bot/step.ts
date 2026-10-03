import type { CombatState, RootAction } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getOpenAction } from '../combat/rules/log'
import { hasOpenAnswer } from '../combat/rules/options'
import { getStartTurnBar, getTurnHolder, hasAgreedToEnd } from '../combat/rules/turn'
import { commitAction, resolveAction, rollOrPay } from '../combat/commands/action'
import { endTurn, startTurn, toggleAgreeToEnd } from '../combat/commands/turn'
import { hasAPLeft } from '../character/rules/surge'
import { act } from './act'
import { answerOpen } from './answer'
import { findParty, getLiveFoes, type Party } from './party'
import { passUp } from './table'

// One move of the bots: the state after the next thing a character a bot
// controls owes the table, or null when there is nothing for them to do — the
// table is waiting on someone else, or the parties have nothing left to do
// this round. A bot answers, commits, rolls and lands what is its own, and
// leaves the rest to whoever owes it (instructions/combat-map.md: "An action
// waits only where someone owes a decision").
export function stepBot(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string): CombatState | null {
  const open = getOpenAction(state)
  const next = open ? stepOpen(state, parties, open, dice, newId) : stepIdle(state, parties, dice, newId)
  return next !== null && next !== state ? next : null
}

function stepOpen(state: CombatState, parties: readonly Party[], open: RootAction, dice: Dice, newId: () => string): CombatState | null {
  const owner = findParty(parties, open.actorId)
  switch (open.step) {
    case 'define':
      return owner ? settleDeclared(state, open, dice, newId) : null
    case 'react':
      return answerAny(state, parties, open, newId) ?? (owner && !isAnswerOwed(state, parties) ? rollOrPay(dice, newId)(state) : null)
    case 'post':
      return owner ? resolveAction(newId)(state) : null
    case 'done':
      return null
  }
}

function answerAny(state: CombatState, parties: readonly Party[], open: RootAction, newId: () => string): CombatState | null {
  for (const party of parties) {
    const answered = answerOpen(state, party, open, newId)
    if (answered) return answered
  }
  return null
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

function stepIdle(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string): CombatState | null {
  const holder = getTurnHolder(state)
  if (holder) {
    const party = findParty(parties, holder)
    return party ? (act(state, party, holder, dice, newId) ?? endTurn(state)) : null
  }

  for (const party of parties) {
    if (getLiveFoes(state, party).length === 0) continue
    const starter = party.members.find((id) => isReadyForTurn(state, party, id, newId))
    if (starter) return startTurn(starter)(state)
  }

  const waiting = parties.flatMap((p) => p.members).find((id) => state.characters[id] && !hasAgreedToEnd(state, id))
  return waiting ? toggleAgreeToEnd(waiting)(state) : null
}

// Whether the character may start a turn now and would have something to do
// in it. The turn is only tried on a copy, with a die that is never kept.
function isReadyForTurn(state: CombatState, party: Party, id: string, newId: () => string): boolean {
  const c = state.characters[id]
  if (!c || !hasAPLeft(c) || getStartTurnBar(state, id) !== null) return false
  return act({ ...state, inTurnCharacter: id }, party, id, () => 0, newId) !== null
}
