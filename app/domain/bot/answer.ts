import type { ActionKind, CombatState, RootAction } from '../combat/types'
import { isDeclarationComplete } from '../combat/rules/action'
import { canAnswer, getLiveReactionsTo } from '../combat/rules/log'
import { getAvailableActions, type ActionOption } from '../combat/rules/options'
import { declareReaction } from '../combat/commands/action'
import { isMember, type Party } from './party'

// The reactions a bot makes: plain defenses, whose declaration is nothing but
// the kind and the row it is made with. Reactions that open an action of
// their own (an opportunity attack, a counterattack, a follow, a flee) are
// left to the table.
const DEFENSES: readonly ActionKind[] = ['block', 'evade', 'guard', 'evasion', 'brace', 'avoidExplosion', 'resist']

function byPrice(a: ActionOption, b: ActionOption): number {
  return (a.cost?.AP ?? 0) - (b.cost?.AP ?? 0) || (a.cost?.STA ?? 0) - (b.cost?.STA ?? 0)
}

// The state after the first member of the party who has a defense to make
// against the committed action declares it: the cheapest the list shows open,
// one that says all it must; a defense only a reaction surge pays for is made
// with the surge (combat.tex "Action surge"). Null when nobody has one.
export function answerOpen(state: CombatState, party: Party, open: RootAction, newId: () => string): CombatState | null {
  if (isMember(party, open.actorId)) return null
  for (const id of party.members) {
    const answered = answerFor(state, id, open, newId)
    if (answered) return answered
  }
  return null
}

// A bot defends itself: standing in for someone else the action is aimed at
// (combat.tex "Protect") is left to the table.
function answerFor(state: CombatState, id: string, open: RootAction, newId: () => string): CombatState | null {
  if (open.targetId !== null && open.targetId !== id) return null
  if (!canAnswer(open, id) || getLiveReactionsTo(state, open.id).some((r) => r.actorId === id)) return null
  const options = getAvailableActions(state, id).filter((o) => o.available && DEFENSES.includes(o.draft.kind)).sort(byPrice)
  for (const option of options) {
    const declared = declareReaction(id, option.draft, newId)(state)
    const reaction = getLiveReactionsTo(declared, open.id).find((r) => r.actorId === id)
    if (reaction && isDeclarationComplete(declared, declared.characters[id], reaction)) return declared
  }
  return null
}
