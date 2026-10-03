import type { CampaignCharacter } from '../../types'
import type { Action, ActionKind, ActionOf, CombatState, RootAction, WithdrawalReason } from '../types'
import { getLiveReactionsTo, getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { reduceBoard, reduceCharacter, reduceFloor, reduceBinds, type Phase } from './reduce'
import { isVoided } from '../rules/opportunity'
import { isAnswerable } from '../rules/action'
import { settleBinds } from './bind'
import { holdMoveTest } from './heldTest'
import { settleSevered } from './floor'
import { getFireTouched } from '../rules/hazard'
import { getBrokenArcs } from '../rules/fireAgain'
import { releaseSpell } from '../../character/commands/spells'
import { deliverAll } from '../../character/commands/deliver'

// The bookkeeping the action commands share: replacing and appending
// records in the fight's action log, landing a phase of an action on
// everything it touches, and keeping the declared reactions in line with
// what the open action still triggers.

// The fight with the actions in play rewritten, and the stack kept to the
// actions still being played out: `pushed` goes on top, anything resolved or
// gone leaves, and what leaves having landed goes into the record, the
// reactions to it before it.
export function setActions(state: CombatState, declared: Action[], pushed: string[] = []): CombatState {
  const stamped = declared.map((a) => (a.turn === null ? { ...a, turn: state.turn } : a))
  const live = new Set(stamped.filter((a) => a.step !== 'done').map((a) => a.id))
  const landed = state.stack.filter((id) => !live.has(id) && stamped.some((a) => a.id === id))
  const entering = landed.flatMap((id) => [...stamped.filter((a) => a.reactionTo === id), stamped.find((a) => a.id === id)!])
  return {
    ...state,
    actions: stamped.filter((a) => !entering.includes(a)),
    stack: [...state.stack, ...pushed].filter((id) => live.has(id)),
    record: [...state.record, ...entering],
  }
}

// Takes a draft back: it was never committed, so nothing is kept of it.
export function discardDraft(state: CombatState, id: string): CombatState {
  return setActions(state, state.actions.filter((a) => a.id !== id && a.reactionTo !== id))
}

// Takes the actions, and whatever answers them, out of play without landing
// them, and writes down what each was and why it went: it was committed, or
// offered to someone, and the table may want to know what became of it.
export function withdrawActions(state: CombatState, ids: string[], reason: WithdrawalReason): CombatState {
  const gone = state.actions.filter((a) => ids.includes(a.id) || (a.reactionTo !== null && ids.includes(a.reactionTo)))
  if (gone.length === 0) return state
  const journal = [...state.journal, ...gone.map((action) => ({ action, reason, round: state.round, turn: state.turn }))]
  return setActions({ ...state, journal }, state.actions.filter((a) => !gone.includes(a)))
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
// "Interruption"); its price was already taken at the roll. A move that
// carried its swimmer's test for the round makes it theirs as it is rolled.
export function applyPhase(state: CombatState, actions: Action[], phase: Phase): CombatState {
  return actions.reduce((held, action) => {
    const s = phase === 'roll' && action.kind === 'move' ? holdMoveTest(held, action) : held
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
  const dropped = live.filter((a) => findTrigger(state, open, { ...a, at: a.kind === 'opportunityAttack' || a.kind === 'retarget' || a.kind === 'flee' ? a.at : undefined }) === null)
  return withdrawActions(state, dropped.map((a) => a.id), 'noLongerTriggered')
}

// The open action, once rolled, when it is of one of the kinds; null
// otherwise — what every choice made after the die starts from.
export function getRolledOpen<K extends ActionKind>(state: CombatState, kinds: readonly K[]): ActionOf<K> | null {
  const open = getOpenAction(state)
  return open && open.step === 'post' && (kinds as readonly ActionKind[]).includes(open.kind) ? open as ActionOf<K> : null
}
