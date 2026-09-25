import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'
import { getActionDef } from './actionCatalog'
import { getDistanceBetween, getMeleeRange } from './board'
import { getReactionsTo } from './action'

export function isTriggeringAction(action: Action): action is TriggeringAction {
  return getActionDef(action.kind).triggering === true
}

// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver or a push.
function isOpportunityAction(action: Action | undefined): action is OpportunityAction {
  return action?.kind === 'strike' || action?.kind === 'grapple' || action?.kind === 'drag'
}

export type DrawnOpportunityAttack = { reaction: ActionOf<'opportunityAttack'>; spawned: OpportunityAction | null }

// combat.tex "Opportunity Attack": each threatener the action drew gets one
// attack, spawned in turn as the one before lands (commands/sequence.ts
// `advanceOpportunities`), each with what it opened if it has. They are
// fought in the order the root comes to them: along the path, for a move or
// a push, whose attacks each fire at a step; in the order they were
// declared, for anything else (combat.tex "Flanking": "resolved in order").
export function getDrawnOpportunityAttacks(state: CombatState, action: Action): DrawnOpportunityAttack[] {
  return getReactionsTo(state, action.id)
    .flatMap((r) => (r.kind === 'opportunityAttack' ? [r] : []))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .map((reaction) => {
      const spawned = state.actions.find((a) => a.spawnedBy === reaction.id)
      return { reaction, spawned: isOpportunityAction(spawned) ? spawned : null }
    })
}

// combat.tex "Flanking": a flanker's opportunity attack "can be voided if
// the target gets out of range" — whether the attacker it answers still
// stands within the flanker's reach once the strike has landed.
export function isFlankInReach(state: CombatState, reaction: ActionOf<'opportunityAttack'>, root: Action): boolean {
  const reactor = state.characters[reaction.actorId]
  const distance = getDistanceBetween(state, reaction.actorId, root.actorId)
  return !!reactor && (distance === null || distance <= getMeleeRange(reactor))
}

// combat.tex "Interruption": "interrupts any action from its victim, making
// them lose its associated costs" — an opportunity attack the action drew
// that lands with interruption cancels it, same as its actor giving it up
// to answer one actively (`cancelTriggeringAction`). A push that moved or
// stopped the actor interrupted them too (combat.tex "Push and drag":
// "interrupts them"). One fought against someone else — a third party's
// against whoever a push moved at them — does not stop the actor. A push
// whose pusher a third party interrupts is cut short where it got to, not
// cancelled (the table's ruling; `getPushStop`).
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  if (action.cancelled) return true
  if (action.kind === 'drag') return false
  return getDrawnOpportunityAttacks(state, action).some(({ spawned }) => spawned?.status === 'resolved' && (
    (spawned.kind === 'strike' && spawned.targetId === action.actorId && spawned.interruption !== 'none')
    || (spawned.kind === 'drag' && (spawned.facts?.interrupted ?? []).includes(action.actorId))))
}

// Whether the action comes to nothing: a triggering action given up or
// interrupted (`isCancelled`). Anything else lands.
export function isVoided(state: CombatState, action: Action): boolean {
  return isTriggeringAction(action) && isCancelled(state, action)
}

// What the opportunity attack being fought answers, while its target could
// still give it up to defend actively: their own triggering action, not yet
// cancelled. spells.tex "Concentration": "No other action or reaction can be
// performed while concentrating"; combat.tex "Opportunity Attack": the same
// for anything else that drew one.
export function getCancellableRoot(state: CombatState, fought: Action, defenderId: string): TriggeringAction | null {
  const reaction = fought.spawnedBy ? state.actions.find((a) => a.id === fought.spawnedBy) : undefined
  const root = reaction?.kind === 'opportunityAttack' && reaction.reactionTo ? state.actions.find((a) => a.id === reaction.reactionTo) : undefined
  return root && isTriggeringAction(root) && root.actorId === defenderId && !root.cancelled ? root : null
}
