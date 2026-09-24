import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'

export function isTriggeringAction(action: Action): action is TriggeringAction {
  return action.kind === 'cast' || action.kind === 'shoot' || action.kind === 'explosion' || action.kind === 'pickUp' || action.kind === 'grapple'
}

// combat.tex "Opportunity Attack": each threatener the action drew gets one
// attack, spawned in turn (commands/action.ts `advanceTriggering`) as
// reactions resolve.
export function getDrawnOpportunityAttacks(state: CombatState, action: TriggeringAction): { reaction: ActionOf<'opportunityAttack'>; spawned: OpportunityAction | null }[] {
  return state.actions
    .flatMap((r) => (r.reactionTo === action.id && r.kind === 'opportunityAttack' ? [r] : []))
    .map((reaction) => {
      const spawned = state.actions.find((a) => a.spawnedBy === reaction.id)
      return { reaction, spawned: spawned?.kind === 'strike' || spawned?.kind === 'grapple' || spawned?.kind === 'drag' ? spawned : null }
    })
}

// combat.tex "Interruption": "interrupts any action from its victim, making
// them lose its associated costs" — an opportunity attack the action drew
// that lands with interruption cancels it, same as its actor giving it up
// to answer one actively (`cancelTriggeringAction`). A push that moved or
// stopped the actor interrupted them too (combat.tex "Push and drag":
// "interrupts them").
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  return action.cancelled || getDrawnOpportunityAttacks(state, action).some(({ spawned }) => spawned?.status === 'resolved' && (
    (spawned.kind === 'strike' && spawned.interruption !== 'none')
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
