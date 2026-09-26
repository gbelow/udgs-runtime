import type { Action, ActionOf, CombatState, OpportunityAction, TriggeringAction } from '../types'
import { getActionDef } from './actionCatalog'
import { getDistanceBetween, getMeleeRange, withPlacements } from './board'
import { getDrawnOpportunityAttacks, getOpeningReaction, getReactionsTo, getRootOf } from './log'
import { isBroken } from './interruption'
import { getMoveFacts, getMoveOverride } from './move'
import { getMoveWaypoint } from './waypoint'
import { getPushStop } from './drag'

export function isTriggeringAction(action: Action): action is TriggeringAction {
  return getActionDef(action.kind).triggering === true
}

// The fight as it will stand when the opportunity attack is fought: against
// a move, with the mover walked one space short of the stretch that fired
// it; against a push, with everyone dragged pushed as far. Reach is judged
// from there.
export function getOpportunityState(state: CombatState, reaction: ActionOf<'opportunityAttack'>): CombatState {
  const root = getRootOf(state, reaction)
  if (root?.kind === 'displace' && reaction.at !== null) {
    const before = reaction.at > 1 ? root.path[reaction.at - 2] : root.from
    return before ? withPlacements(state, before) : state
  }
  if (root?.kind !== 'move' || reaction.at === null) return state
  const waypoint = getMoveWaypoint(state, root, reaction.at - 1)
  return waypoint ? withPlacements(state, { [root.actorId]: waypoint }) : state
}

// Where the root's run of opportunity attacks was brought to a stop, as the
// step the one stopped stands short of; null while it goes on. A move is
// stopped by what `getMoveOverride` reads, a push by an attack that
// interrupted the pusher (`getPushStop`). Anything else is never stopped:
// every attack it drew is fought, even once one has cancelled it (the
// table's ruling), since there is no later stretch it fails to reach.
export function getOpportunityStop(state: CombatState, root: Action): number | null {
  if (root.kind === 'move') return getMoveOverride(state, root)?.step ?? null
  if (root.kind === 'displace') return getPushStop(state, root)
  return null
}

// Whether the root gets as far as the stretch the attack fires on: a move
// cut short — at a turn, a trample, a fall — never reaches the attacks
// further along. A catch is fought where the runner already stands, so one
// on the last step still comes (combat.tex "Catch").
export function isOpportunityReached(state: CombatState, root: Action, reaction: ActionOf<'opportunityAttack'>): boolean {
  if (root.kind !== 'move' || reaction.at === null) return true
  const catching = reaction.grab && root.movement === 'run' ? 1 : 0
  return reaction.at - catching <= getMoveFacts(state, root).path.length
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
