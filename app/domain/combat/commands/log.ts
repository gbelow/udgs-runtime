import type { CampaignCharacter } from '../../types'
import type { Action, ActionKind, ActionOf, CombatState, RootAction } from '../types'
import { getLiveReactionsTo, getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { reduceBoard, reduceCharacter, reduceFloor, reduceBinds, type Phase } from './reduce'
import { isVoided } from '../rules/opportunity'
import { isAnswerable } from '../rules/action'
import { settleBinds } from './bind'
import { settleSevered } from './floor'
import { getFireTouched } from '../rules/hazard'
import { getBrokenArcs } from '../rules/fireAgain'
import { releaseSpell } from '../../character/commands/spells'
import { deliverAll } from '../../character/commands/deliver'

// The bookkeeping the action commands share: replacing and appending
// records in the fight's action log, landing a phase of an action on
// everything it touches, and keeping the declared reactions in line with
// what the open action still triggers.

// The fight with its log rewritten, and the stack kept to the actions still
// being played out: `pushed` goes on top, anything resolved or gone leaves,
// and what leaves having landed goes into the history.
export function setActions(state: CombatState, actions: Action[], pushed: string[] = []): CombatState {
  const live = new Set(actions.filter((a) => a.step !== 'done').map((a) => a.id))
  const landed = state.stack.filter((id) => !live.has(id) && actions.some((a) => a.id === id && !a.declined))
  return { ...state, actions, stack: [...state.stack, ...pushed].filter((id) => live.has(id)), history: [...state.history, ...landed] }
}

export function replaceActions(state: CombatState, next: Action[]): CombatState {
  return setActions(state, state.actions.map((a) => next.find((n) => n.id === a.id) ?? a))
}

// Every root added is pushed, in the order given, so the last goes first.
export function appendActions(state: CombatState, added: Action[]): CombatState {
  return added.length === 0 ? state : setActions(state, [...state.actions, ...added], added.filter((a) => a.reactionTo === null).map((a) => a.id))
}

function mapCharacters(state: CombatState, f: (c: CampaignCharacter) => CampaignCharacter): CombatState {
  return { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, f(c)])) }
}

// A voided action lands nothing at its resolve (combat.tex
// "Interruption"); its price was already taken at the roll.
export function applyPhase(state: CombatState, actions: Action[], phase: Phase): CombatState {
  return actions.reduce((s, action) => {
    if (phase === 'resolve' && isVoided(s, action)) return s
    const board = s.board ? reduceBoard(s, action, phase)(s.board) : null
    const fire = phase === 'resolve' ? getFireTouched({ ...s, board }, action) : null
    const next = mapCharacters(s, reduceCharacter(action, phase, fire))
    const placed = { ...next, board, floor: reduceFloor(s, action, phase)(s.floor), binds: reduceBinds(s, action, phase)(next.binds) }
    return settleSevered(s, action.id)(settleBinds(phase === 'resolve' ? settleArcs(placed) : placed))
  }, state)
}

// spells.tex "Sustained Lightning": an arc that breaks ends its spell, and a
// touch short-circuits it onto both ends. Read where each action leaves the
// board; a broken arc does not come back, it is cast again.
function settleArcs(state: CombatState): CombatState {
  const broken = getBrokenArcs(state)
  if (broken.length === 0) return state
  return mapCharacters(state, (c) => {
    const released = broken.filter((b) => b.casterId === c.id).reduce((acc, b) => releaseSpell(b.key)(acc), c)
    return deliverAll(broken.filter((b) => b.casterId === c.id || b.targetId === c.id).flatMap((b) => b.shock))(released)
  })
}

// The fight's actions less the character's reaction to the action, if it is
// still only declared.
export function withoutLiveReaction(state: CombatState, rootId: string, actorId: string): Action[] {
  const live = getLiveReactionsTo(state, rootId).filter((r) => r.actorId === actorId)
  return state.actions.filter((a) => !live.includes(a))
}

// The open action while it is at the step; null otherwise.
export function getOpenAt(state: CombatState, step: Action['step']): RootAction | null {
  const open = getOpenAction(state)
  return open && open.step === step ? open : null
}

// The open action while reactions to it can still be declared or taken
// back; null otherwise.
export function getAnswerableOpen(state: CombatState): RootAction | null {
  const open = getOpenAction(state)
  return open && isAnswerable(state, open) ? open : null
}

// Drops every reaction to the open action that its triggers no longer
// offer, as its declaration changes.
export function pruneReactions(state: CombatState): CombatState {
  const open = getOpenAt(state, 'react')
  if (!open) return state
  const live = getLiveReactionsTo(state, open.id)
  const kept = state.actions.filter((a) => !live.includes(a) || findTrigger(state, open, { ...a, at: a.kind === 'opportunityAttack' || a.kind === 'flee' ? a.at : undefined }) !== null)
  return kept.length === state.actions.length ? state : setActions(state, kept)
}

// The open action, once rolled, when it is of one of the kinds; null
// otherwise — what every choice made after the die starts from.
export function getRolledOpen<K extends ActionKind>(state: CombatState, kinds: readonly K[]): ActionOf<K> | null {
  const open = getOpenAction(state)
  return open && open.step === 'post' && (kinds as readonly ActionKind[]).includes(open.kind) ? open as ActionOf<K> : null
}
