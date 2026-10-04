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

export function getExchange(state: CombatState, party: Party, actorId: string, tuning: Tuning, newId: () => string): number {
  const open = getOpenAction(state)
  if (!open || open.actorId !== actorId || open.targetId === null || isMember(party, open.targetId)) return 0
  const targetId = open.targetId
  const answers = [
    { state, spent: 0 },
    ...getDefenseOptions(state, targetId, open).flatMap((option) => {
      const declared = declareDefense(state, targetId, open, option, newId)
      const reaction = declared && getLiveReactionsTo(declared, open.id).find((r) => r.actorId === targetId)
      return declared && reaction ? [{ state: declared, spent: apOf(declared, reaction) }] : []
    }),
  ]
  const gained = answers.map((a) => tuning.exchange * expectedLoss(a.state, targetId) + tuning.drain * a.spent)
  return Math.min(...gained)
}
