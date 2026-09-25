import type { CampaignCharacter } from '../../types'
import type { Action, ActionKind, ActionOf, CombatState } from '../types'
import { getLiveReactionsTo, getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { reduceBoard, reduceCharacter, reduceFloor, reduceGrapples, type Phase } from './reduce'
import { isTriggeringAction } from '../rules/opportunity'
import { settleGrapples } from './grapple'

// The bookkeeping the action commands share: replacing and appending
// records in the fight's action log, landing a phase of an action on
// everything it touches, and keeping the declared reactions in line with
// what the open action still triggers.

export function replaceActions(state: CombatState, next: Action[]): CombatState {
  return { ...state, actions: state.actions.map((a) => next.find((n) => n.id === a.id) ?? a) }
}

export function appendActions(state: CombatState, added: Action[]): CombatState {
  return added.length === 0 ? state : { ...state, actions: [...state.actions, ...added] }
}

function mapCharacters(state: CombatState, f: (c: CampaignCharacter) => CampaignCharacter): CombatState {
  return { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, f(c)])) }
}

// A cancelled action lands nothing at its resolve (combat.tex
// "Interruption"); its price was already taken at the roll.
export function applyPhase(state: CombatState, actions: Action[], phase: Phase): CombatState {
  return actions.reduce((s, action) => {
    if (phase === 'resolve' && isTriggeringAction(action) && action.cancelled) return s
    const next = mapCharacters(s, reduceCharacter(action, phase))
    const grappled = { ...next, floor: reduceFloor(s, action, phase)(s.floor), grapples: reduceGrapples(action, phase)(next.grapples) }
    const placed = grappled.board ? { ...grappled, board: reduceBoard(next, action, phase)(grappled.board) } : grappled
    return settleGrapples(s.grapples)(placed)
  }, state)
}

// The fight's actions less the character's reaction to the action, if it is
// still only declared.
export function withoutLiveReaction(state: CombatState, rootId: string, actorId: string): Action[] {
  const live = getLiveReactionsTo(state, rootId).filter((r) => r.actorId === actorId)
  return state.actions.filter((a) => !live.includes(a))
}

// Drops every reaction to the open action that its triggers no longer
// offer: what a push moves someone into depends on the way it is pointed,
// so a third party's opportunity attack goes when the way changes
// (combat.tex "Push and drag").
export function pruneReactions(state: CombatState): CombatState {
  const open = getOpenAction(state)
  if (!open || !(open.status === 'committed' || (open.kind === 'drag' && open.status === 'rolled' && !open.fought))) return state
  const live = getLiveReactionsTo(state, open.id)
  const kept = state.actions.filter((a) => !live.includes(a) || findTrigger(state, open, { ...a, at: a.kind === 'opportunityAttack' ? a.at : undefined }) !== null)
  return kept.length === state.actions.length ? state : { ...state, actions: kept }
}

// The open action, once rolled, when it is of one of the kinds; null
// otherwise — what every choice made after the die starts from.
export function getRolledOpen<K extends ActionKind>(state: CombatState, kinds: readonly K[]): ActionOf<K> | null {
  const open = getOpenAction(state)
  return open && open.status === 'rolled' && (kinds as readonly ActionKind[]).includes(open.kind) ? open as ActionOf<K> : null
}
