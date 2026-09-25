import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'

export function isTriggeringAction(action: Action): action is TriggeringAction {
  return action.kind === 'cast' || action.kind === 'shoot' || action.kind === 'explosion' || action.kind === 'pickUp' || action.kind === 'grapple' || action.kind === 'drag'
}

// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver or a push.
export function isOpportunityAction(action: Action | undefined): action is OpportunityAction {
  return action?.kind === 'strike' || action?.kind === 'grapple' || action?.kind === 'drag'
}

export type DrawnOpportunityAttack = { reaction: ActionOf<'opportunityAttack'>; spawned: OpportunityAction | null }

// combat.tex "Opportunity Attack": each threatener the action drew gets one
// attack, spawned in turn (commands/action.ts `advanceTriggering`,
// `advanceMove`) as reactions resolve — in the order they were declared,
// each with what it opened if it has.
export function getDrawnOpportunityAttacks(state: CombatState, action: Action): DrawnOpportunityAttack[] {
  return state.actions
    .flatMap((r) => (r.reactionTo === action.id && r.kind === 'opportunityAttack' ? [r] : []))
    .map((reaction) => {
      const spawned = state.actions.find((a) => a.spawnedBy === reaction.id)
      return { reaction, spawned: isOpportunityAction(spawned) ? spawned : null }
    })
}

// combat.tex "Interruption": "interrupts any action from its victim, making
// them lose its associated costs" — an opportunity attack the action drew
// that lands with interruption cancels it, same as its actor giving it up
// to answer one actively (`cancelTriggeringAction`). A push that moved or
// stopped the actor interrupted them too (combat.tex "Push and drag":
// "interrupts them"). One fought against someone else — a third party's
// against whoever a push moved at them — does not stop the actor.
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  return action.cancelled || getDrawnOpportunityAttacks(state, action).some(({ spawned }) => spawned?.status === 'resolved' && (
    (spawned.kind === 'strike' && spawned.targetId === action.actorId && spawned.interruption !== 'none')
    || (spawned.kind === 'drag' && (spawned.facts?.interrupted ?? []).includes(action.actorId))))
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
