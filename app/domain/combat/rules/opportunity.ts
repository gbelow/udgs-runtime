import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'
import { getActionDef } from './actionCatalog'
import { getDistanceBetween, getMeleeRange } from './board'
import { getOpeningReaction, getReactionsTo, getRootOf } from './log'

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
// `openBefore`), each with what it opened if it has. They are
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
// stands within the flanker's reach when it comes to be fought.
export function isFlankInReach(state: CombatState, reaction: ActionOf<'opportunityAttack'>, root: Action): boolean {
  const reactor = state.characters[reaction.actorId]
  const distance = getDistanceBetween(state, reaction.actorId, root.actorId)
  return !!reactor && (distance === null || distance <= getMeleeRange(reactor))
}

// combat.tex "Interruption": "interrupts any action from its victim" —
// whether the action is a strike that has landed on the character with an
// interruption.
export function isInterruptingStrike(action: Action | null | undefined, victimId: string): boolean {
  return action?.kind === 'strike' && action.step === 'done' && action.targetId === victimId && action.interruption !== 'none'
}

// Whether an opportunity attack the action drew has landed with an
// interruption on its actor. A push that moved or stopped the actor
// interrupted them too (combat.tex "Push and drag": "interrupts them"). One
// fought against someone else — a third party's against whoever a push
// moved at them — does not stop the actor.
function isInterruptedByOpportunity(state: CombatState, action: Action): boolean {
  return getDrawnOpportunityAttacks(state, action).some(({ spawned }) => isInterruptingStrike(spawned, action.actorId)
    || (spawned?.kind === 'drag' && spawned.step === 'done' && (spawned.facts?.interrupted ?? []).includes(action.actorId)))
}

// A triggering action comes to nothing once its actor gives it up to answer
// an opportunity attack actively (`cancelTriggeringAction`) or one
// interrupts them. A push whose pusher a third party interrupts is cut short
// where it got to, not cancelled (the table's ruling; `getPushStop`).
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  if (action.cancelled) return true
  return action.kind !== 'drag' && isInterruptedByOpportunity(state, action)
}

// Whether the action comes to nothing: a triggering action given up or
// interrupted (`isCancelled`), or a strike a flanker interrupted before it
// landed (the table's ruling: an interruption breaks the action). A move is
// cut short instead (`getMoveOverride`); anything else lands.
export function isVoided(state: CombatState, action: Action): boolean {
  if (isTriggeringAction(action)) return isCancelled(state, action)
  return action.kind === 'strike' && isInterruptedByOpportunity(state, action)
}

// What the opportunity attack being fought answers, while its target could
// still give it up to defend actively: their own triggering action, not yet
// cancelled. spells.tex "Concentration": "No other action or reaction can be
// performed while concentrating"; combat.tex "Opportunity Attack": the same
// for anything else that drew one.
export function getCancellableRoot(state: CombatState, fought: Action, defenderId: string): TriggeringAction | null {
  const reaction = getOpeningReaction(state, fought)
  const root = reaction ? getRootOf(state, reaction) : null
  return root && isTriggeringAction(root) && root.actorId === defenderId && !root.cancelled ? root : null
}
