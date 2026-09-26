import type { Action, ActionOf, CombatState, DragAction, OpportunityAction, TriggeringAction } from '../types'
import { getActionDef } from './actionCatalog'
import { getDistanceBetween, getMeleeRange } from './board'
import { getOpeningReaction, getReactionsTo, getRootOf } from './log'
import { getCounterattack, getCounterSlot, getCounterStrikeOf } from './counter'

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
// interruption on its actor. A push made as one interrupts them too, if
// they resisted it actively or it moved them (combat.tex "Push and drag":
// "interrupts them"). One fought against someone else — a third party's
// against whoever a push moved at them — does not stop the actor.
function isInterruptedByOpportunity(state: CombatState, action: Action): boolean {
  return getDrawnOpportunityAttacks(state, action).some(({ spawned }) => isInterruptingStrike(spawned, action.actorId)
    || (spawned?.kind === 'drag' && isInterruptedByPush(state, spawned, action.actorId)))
}

function isInterruptedByPush(state: CombatState, push: DragAction, id: string): boolean {
  if (push.step !== 'done') return false
  const walked = state.actions.find((a) => a.kind === 'displace' && a.spawnedBy === push.id)
  const moved = walked?.kind === 'displace' && walked.step === 'done' ? walked.facts?.interrupted ?? [] : []
  return [...(push.facts?.interrupted ?? []), ...moved].includes(id)
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
// (`getGivenUpFor`) or an opportunity attack interrupts them. A push whose
// pusher a third party interrupts is cut short where it got to, not
// cancelled (the table's ruling; `getPushStop`).
export function isCancelled(state: CombatState, action: TriggeringAction): boolean {
  if (getGivenUpFor(state, action) !== null) return true
  return action.kind !== 'displace' && isInterruptedByOpportunity(state, action)
}

// Whether the action comes to nothing: a triggering action given up or
// interrupted (`isCancelled`), or a strike a flanker, or a counterattack
// that rolled higher, interrupted before it landed (the table's ruling: an
// interruption breaks the action). A move is cut short instead
// (`getMoveOverride`); anything else lands.
export function isVoided(state: CombatState, action: Action): boolean {
  if (isTriggeringAction(action)) return isCancelled(state, action)
  return action.kind === 'strike' && (isInterruptedByOpportunity(state, action) || isInterruptedByCounter(state, action))
}

// abilities.tex "Counterattack": "The attack with the higher result hits
// first, having the chance to interrupt the opponent."
function isInterruptedByCounter(state: CombatState, action: Action): boolean {
  const counter = getCounterattack(state, action)
  return counter !== null && getCounterSlot(action, counter) === 'before' && isInterruptingStrike(getCounterStrikeOf(state, counter), action.actorId)
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
