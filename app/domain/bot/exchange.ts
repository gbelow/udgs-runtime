import type { Action, CombatState } from '../combat/types'
import { getPayableCost } from '../combat/rules/action'
import { getLiveReactionsTo, getOpenAction } from '../combat/rules/log'
import { declareDefense, getDefenseOptions } from './answer'
import { isMember, type Party, type Tuning } from './party'
import { expectedLoss } from './value'

// What the attack a character has just committed is worth before any die is
// weighed against the fight: the damage it takes from its target on average
// over the die, and the AP its target pays to answer it. The target answers as
// it would weigh it: of no defense and each defense open to it, the one that
// leaves the attacker the least. Zero for an option that is not an attack on a
// foe.

function apOf(state: CombatState, action: Action): number {
  return getPayableCost(state, action)?.AP ?? 0
}

type Answer = { state: CombatState; spent: number; surged: boolean }

// The attack the character has committed on a foe, and every defense its
// target could still declare against it.
function getAnswers(state: CombatState, party: Party, actorId: string, newId: () => string): { targetId: string; answers: Answer[] } | null {
  const open = getOpenAction(state)
  if (!open || open.actorId !== actorId || open.targetId === null || isMember(party, open.targetId)) return null
  const targetId = open.targetId
  const answers = getDefenseOptions(state, targetId, open).flatMap((option): Answer[] => {
    const declared = declareDefense(state, targetId, open, option, newId)
    const reaction = declared && getLiveReactionsTo(declared, open.id).find((r) => r.actorId === targetId)
    return declared && reaction ? [{ state: declared, spent: apOf(declared, reaction), surged: option.surge !== null }] : []
  })
  return { targetId, answers }
}

export function getExchange(state: CombatState, party: Party, actorId: string, tuning: Tuning, newId: () => string): number {
  const found = getAnswers(state, party, actorId, newId)
  if (!found) return 0
  const gained = [{ state, spent: 0, surged: false }, ...found.answers].map((a) => tuning.exchange * expectedLoss(a.state, found.targetId) + tuning.drain * a.spent)
  return Math.min(...gained)
}

// Whether the attack the character has just committed on a foe has a target
// with a defense left to answer it with: any, or only one its own AP pays for
// when `surges` is false (a defense that takes a reaction surge does not count).
export function isAnswerable(state: CombatState, party: Party, actorId: string, surges: boolean, newId: () => string): boolean {
  return (getAnswers(state, party, actorId, newId)?.answers.filter((a) => surges || !a.surged).length ?? 0) > 0
}
