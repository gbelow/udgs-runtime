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

// The defenses the character may declare against the committed action, the
// cheapest first. A bot defends itself: standing in for someone else the
// action is aimed at (combat.tex "Protect") is left to the table. A defense
// only a reaction surge pays for is made with the surge (combat.tex "Action
// surge").
export function getDefenseOptions(state: CombatState, id: string, open: RootAction): ActionOption[] {
  if (open.targetId !== null && open.targetId !== id) return []
  if (!canAnswer(open, id) || getLiveReactionsTo(state, open.id).some((r) => r.actorId === id)) return []
  return getAvailableActions(state, id).filter((o) => o.available && DEFENSES.includes(o.draft.kind)).sort(byPrice)
}

// The state with the defense declared, if it says all it must.
export function declareDefense(state: CombatState, id: string, open: RootAction, option: ActionOption, newId: () => string): CombatState | null {
  const declared = declareReaction(id, option.draft, newId)(state)
  const reaction = getLiveReactionsTo(declared, open.id).find((r) => r.actorId === id)
  return reaction && isDeclarationComplete(declared, declared.characters[id], reaction) ? declared : null
}

// The answer a bot gives without weighing it: the first member of the party,
// bar those named, who has a defense to make declares the cheapest. Null when
// nobody has one. It stands in for the others' answers when an option is
// played out.
export function answerOpen(state: CombatState, party: Party, open: RootAction, newId: () => string, skip: readonly string[] = []): CombatState | null {
  if (isMember(party, open.actorId)) return null
  for (const id of party.members.filter((m) => !skip.includes(m))) {
    for (const option of getDefenseOptions(state, id, open)) {
      const declared = declareDefense(state, id, open, option, newId)
      if (declared) return declared
    }
  }
  return null
}
