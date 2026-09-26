import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'
import { getActionDef } from './actionCatalog'
import { getDistanceBetween, getMeleeRange } from './board'
import { getOpenedBy, getOpeningReaction, getReactionsTo, getRootOf } from './log'
import { isBroken } from './interruption'

export function isTriggeringAction(action: Action): action is TriggeringAction {
  return getActionDef(action.kind).triggering === true
}

// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver or a push.
function isOpportunityAction(action: Action | null): action is OpportunityAction {
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
      const spawned = getOpenedBy(state, reaction)
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

// combat.tex "Opportunity Attack": "It is possible to cancel the triggering
// action and reuse the AP spent to defend against an opportunity attack." Its
// actor gives it up by answering one of the attacks it drew with anything
// but the SD (spells.tex "Concentration": "No other action or reaction can
// be performed while concentrating"; the same for anything else that drew
// one). The attack it was given up for is the first they answered; taking
// the answer back before that attack's die keeps the action.
export function getGivenUpFor(state: CombatState, action: TriggeringAction): OpportunityAction | null {
  return getDrawnOpportunityAttacks(state, action).find(({ spawned }) =>
    spawned !== null && getReactionsTo(state, spawned.id).some((r) => r.actorId === action.actorId))?.spawned ?? null
}

// A triggering action comes to nothing once its actor gives it up
// (`getGivenUpFor`) or it is broken (`isBroken`).
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  return getGivenUpFor(state, action) !== null || isBroken(state, action)
}

// Whether the action comes to nothing: a triggering action given up, or
// anything broken by an interruption before its effect (`isBroken`).
export function isVoided(state: CombatState, action: Action): boolean {
  return isTriggeringAction(action) ? isCancelled(state, action) : isBroken(state, action)
}

// The triggering action of the defender's that answering the opportunity
// attack being fought with anything but the SD gives up (`getGivenUpFor`):
// theirs, not yet given up for another attack. Null when there is none.
export function getCancellableRoot(state: CombatState, fought: Action, defenderId: string): TriggeringAction | null {
  const reaction = getOpeningReaction(state, fought)
  const root = reaction ? getRootOf(state, reaction) : null
  if (!root || !isTriggeringAction(root) || root.actorId !== defenderId) return null
  const given = getGivenUpFor(state, root)
  return given === null || given.id === fought.id ? root : null
}
