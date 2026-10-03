import type { CombatState } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getOpenAction } from '../combat/rules/log'
import { getTurnHolder, hasAgreedToEnd } from '../combat/rules/turn'
import { endTurn, startTurn, toggleAgreeToEnd } from '../combat/commands/turn'
import { chooseAnyAnswer, chooseTurnAction } from './choose'
import { stepOpen } from './open'
import { findParty, getLiveFoes, type Party } from './party'
import type { Trace } from './trace'

// One move of the bots: the state after the next thing a character a bot
// controls owes the table, or null when there is nothing for them to do — the
// table is waiting on someone else, or the parties have nothing left to do
// this round. A bot answers, commits, rolls and lands what is its own, and
// leaves the rest to whoever owes it (instructions/combat-map.md: "An action
// waits only where someone owes a decision"). What it weighs in choosing is
// handed to `trace`.
export function stepBot(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, trace?: Trace): CombatState | null {
  const open = getOpenAction(state)
  const next = open ? stepOpen(state, parties, open, dice, newId, chooseAnyAnswer(trace)) : stepIdle(state, parties, dice, newId, trace)
  return next !== null && next !== state ? next : null
}

// Holding is passing for the rest of the round with what AP is left, kept to
// defend with.
function hold(state: CombatState, id: string): CombatState | null {
  const ended = endTurn(state)
  return ended === state ? null : toggleAgreeToEnd(id)(ended)
}

function stepIdle(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string, trace?: Trace): CombatState | null {
  const holder = getTurnHolder(state)
  if (holder) {
    const party = findParty(parties, holder)
    return party ? (chooseTurnAction(state, parties, party, holder, dice, newId, trace) ?? hold(state, holder)) : null
  }

  for (const party of parties) {
    if (getLiveFoes(state, party).length === 0) continue
    for (const id of party.members) {
      if (!state.characters[id] || hasAgreedToEnd(state, id)) continue
      const turn = startTurn(id)(state)
      const acted = turn !== state ? chooseTurnAction(turn, parties, party, id, dice, newId, trace) : null
      if (acted) return acted
    }
  }

  const waiting = parties.flatMap((p) => p.members).find((id) => state.characters[id] && !hasAgreedToEnd(state, id))
  return waiting ? toggleAgreeToEnd(waiting)(state) : null
}
