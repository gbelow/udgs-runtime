import { isCombatStarted } from '../rules/started'
import type { CampaignCharacter } from '../../types'
import type { Action, ActionKind, ActionOf, SceneState, RootAction, WithdrawalReason } from '../types'
import { getAction, getLiveActions, getParticipants, getLiveReactionsTo, getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { reduceBoard, reduceCharacter, reduceFloor, reduceBinds, type Phase } from './reduce'
import { isVoided } from '../rules/opportunity'
import { getInterruptionsLanding, type StampedInterruption } from '../rules/interruption'
import { getReactedWithin } from '../rules/prepared'
import { isAnswerable } from '../rules/action'
import { settleBinds } from './bind'
import { dropFallenBalance, holdThrown } from './heldTest'
import { getHeldRolls } from '../rules/heldRoll'
import { getNoise } from '../rules/stealth'
import { settleSevered } from './floor'
import { getFireTouched } from '../rules/board/hazard'
import { getChanges } from '../rules/changes'
import { getBrokenArcs } from '../rules/fireAgain'
import { releaseSpell } from '../../character/commands/spells'
import { deliverAll } from '../../character/commands/deliver'

// The bookkeeping the action commands share: replacing and appending
// records in the fight's action log, landing a phase of an action on
// everything it touches, and keeping the declared reactions in line with
// what the open action still triggers.

// The fight with the actions in play rewritten, and the stack kept to the
// actions still being played out: `pushed` goes on top, anything resolved or
// gone leaves, an action held over to the next round is in play but waits
// off the stack, and what leaves having landed is noted as landed, the
// reactions to it before it; what was in play and is not declared any more
// leaves the table. A move past its declaration carries the held
// tests its mover had made when it got there, and the turn it was committed
// in is noted as taken. What lands is noted in the round's registries: the
// noise it made in its actor's own turn, the preparation it is.
export function setActions(state: SceneState, declared: Action[], pushed: string[] = []): SceneState {
  const stamped = declared.map((a) => noteParticipants(state, stampHeld(state, a.turn === null ? { ...a, turn: state.turn, round: state.round } : a)))
  const live = new Set(stamped.filter((a) => a.step !== 'done').map((a) => a.id))
  const landed = state.stack.filter((id) => !live.has(id) && stamped.some((a) => a.id === id))
  const entering = landed.flatMap((id) => [...stamped.filter((a) => a.reactionTo === id), stamped.find((a) => a.id === id)!])
  const wasLive = new Set(state.live)
  const added = stamped.filter((a) => !wasLive.has(a.id))
  const actions = { ...state.actions }
  for (const id of state.live) delete actions[id]
  for (const a of stamped) actions[a.id] = a
  return noteReactedWithin(added, entering, noteInterruptions(entering, {
    ...state,
    actions,
    live: stamped.filter((a) => !entering.includes(a)).map((a) => a.id),
    stack: [...state.stack, ...pushed].filter((id) => live.has(id) && actions[id].step !== 'held'),
    landed: [...state.landed, ...entering.map((a) => a.id)],
    turnsTaken: stamped.reduce(noteTurn, state.turnsTaken),
    stealthTurns: entering.reduce((turns, a) => noteNoise(state, turns, a), state.stealthTurns),
    prepared: [...state.prepared, ...entering.flatMap((a) => (a.kind === 'prepare' ? [a.id] : []))],
    bodyCover: entering.reduce((cover, a) => noteCover(state, stamped, cover, a), state.bodyCover),
  }))
}

// The action with every character its record names noted on it.
function noteParticipants(state: SceneState, action: Action): Action {
  const participants = getParticipants(state, action)
  return participants === action.participants ? action : { ...action, participants }
}

// A reaction newly declared is noted on what it comes of that its own actor
// took, still in play or landing with it.
function noteReactedWithin(added: Action[], entering: Action[], state: SceneState): SceneState {
  const notes = new Map<string, string[]>()
  for (const declared of added) {
    for (const on of getReactedWithin(state, declared)) notes.set(on.id, [...(notes.get(on.id) ?? []), declared.id])
  }
  return withNotes(state, entering, notes, (a, ids) => ({ ...a, reactedWithin: [...a.reactedWithin, ...ids] }))
}

// The fight with each noted action rewritten by `note`, if it is in play or
// has just landed: what landed before is not written to again.
function withNotes<T>(state: SceneState, entering: Action[], notes: Map<string, T[]>, note: (a: Action, noted: T[]) => Action): SceneState {
  const open = new Set([...state.live, ...entering.map((a) => a.id)])
  const written = [...notes].filter(([id]) => open.has(id))
  if (written.length === 0) return state
  const actions = { ...state.actions }
  for (const [id, noted] of written) actions[id] = note(actions[id], noted)
  return { ...state, actions }
}

// What lands, in the order it lands, is noted on each action it interrupts
// that has yet to land: one still in play, or one landing after it.
function noteInterruptions(entering: Action[], state: SceneState): SceneState {
  const notes = new Map<string, StampedInterruption[]>()
  entering.forEach((by, i) => {
    for (const { on, interruption } of getInterruptionsLanding(state, by)) {
      const at = entering.findIndex((a) => a.id === on.id)
      if (at === -1 ? state.live.includes(on.id) : at > i) notes.set(on.id, [...(notes.get(on.id) ?? []), interruption])
    }
  })
  return withNotes(state, entering, notes, (a, noted) => ({ ...a, interruptions: [...a.interruptions, ...noted] }))
}

// combat.tex "Cover": a guard that takes cover behind a body shield leaves
// its guard behind it, the shield facing where the guarded shot came from;
// "The cover is canceled if the character performs any action other than
// careful movement" — a reaction as much as an action. Nothing is noted on a
// fight without a board, where no shot comes from anywhere.
function noteCover(state: SceneState, declared: Action[], cover: SceneState['bodyCover'], action: Action): SceneState['bodyCover'] {
  const { [action.actorId]: _left, ...rest } = cover
  if (action.kind === 'guard' && action.cover) {
    const shot = declared.find((a) => a.id === action.reactionTo) ?? (action.reactionTo ? getAction(state, action.reactionTo) : null)
    const toward = shot ? state.board?.placements[shot.actorId]?.cell : undefined
    return toward ? { ...rest, [action.actorId]: { weaponKey: action.weaponKey, toward } } : rest
  }
  return !cover[action.actorId] || (action.kind === 'move' && action.movement === 'careful') ? cover : rest
}

// combat.tex "Actions in stealth": "a cumulative penalty is added to the
// stealth value until the end of the turn" — counted only for what the
// turn's holder does in it, at the price it was paid.
function noteNoise(state: SceneState, turns: SceneState['stealthTurns'], action: Action): SceneState['stealthTurns'] {
  if (action.turn !== state.turn) return turns
  const noise = getNoise(state, action, action.cost?.AP ?? 0)
  return turns.map((t) => (t.turn === action.turn && t.id === action.actorId ? { ...t, AP: t.AP + noise.AP, heardAP: t.heardAP + noise.heardAP } : t))
}

function stampHeld(state: SceneState, action: Action): Action {
  return action.kind === 'move' && action.step !== 'define' && action.held === null ? { ...action, held: getHeldRolls(state, action.actorId) } : action
}

function noteTurn(turns: SceneState['turnsTaken'], action: Action): SceneState['turnsTaken'] {
  if (action.step === 'define' || action.turn === null) return turns
  const taken = turns.find((t) => t.turn === action.turn)
  const rests = action.kind === 'rest' && !taken?.rested.includes(action.actorId)
  if (taken && !rests) return turns
  const rested = [...(taken?.rested ?? []), ...(rests ? [action.actorId] : [])]
  return [...turns.filter((t) => t !== taken), { turn: action.turn, rested }]
}

// Takes a draft back: it was never committed, so nothing is kept of it.
export function discardDraft(state: SceneState, id: string): SceneState {
  return setActions(state, getLiveActions(state).filter((a) => a.id !== id && a.reactionTo !== id))
}

// Takes the actions, and whatever answers them, out of play without landing
// them, and writes down what each was and why it went: it was committed, or
// offered to someone, and the table may want to know what became of it.
export function withdrawActions(state: SceneState, ids: string[], reason: WithdrawalReason): SceneState {
  const live = getLiveActions(state)
  const gone = live.filter((a) => ids.includes(a.id) || (a.reactionTo !== null && ids.includes(a.reactionTo)))
  if (gone.length === 0) return state
  const journal = [...state.journal, ...gone.map((action) => ({ action, reason, round: state.round, turn: state.turn }))]
  return setActions({ ...state, journal }, live.filter((a) => !gone.includes(a)))
}

export function replaceActions(state: SceneState, next: Action[]): SceneState {
  return setActions(state, getLiveActions(state).map((a) => next.find((n) => n.id === a.id) ?? a))
}

// Every root added is pushed, in the order given, so the last goes first.
export function appendActions(state: SceneState, added: Action[]): SceneState {
  return added.length === 0 ? state : setActions(state, [...getLiveActions(state), ...added], added.filter((a) => a.reactionTo === null).map((a) => a.id))
}

function mapCharacters(state: SceneState, f: (c: CampaignCharacter) => CampaignCharacter): SceneState {
  return { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, f(c)])) }
}

// A voided action lands nothing at its resolve (combat.tex
// "Interruption"); its price was already taken at the roll. A held test's die
// is its actor's for the round as it is thrown, and a fall has them test their
// balance again.
export function applyPhase(state: SceneState, actions: Action[], phase: Phase): SceneState {
  return actions.reduce((held, action) => {
    const applied = applyOne(held, action, phase)
    const changes = getChanges(held, applied, phase)
    if (changes.length === 0) return applied
    const noted = getAction(applied, action.id)
    return noted ? { ...applied, actions: { ...applied.actions, [action.id]: { ...noted, changes: [...noted.changes, ...changes] } } } : applied
  }, state)
}

function applyOne(s: SceneState, action: Action, phase: Phase): SceneState {
  const thrown = phase === 'roll' ? holdThrown(s, action) : s
  if (phase === 'resolve' && isVoided(thrown, action)) return thrown
  const rolled = phase === 'resolve' ? dropFallenBalance(thrown, action) : thrown
  const board = rolled.board ? reduceBoard(rolled, action, phase)(rolled.board) : null
  const fire = phase === 'resolve' ? getFireTouched({ ...rolled, board }, action) : null
  const next = mapCharacters(rolled, reduceCharacter(action, phase, isCombatStarted(rolled), fire))
  const placed = { ...next, board, floor: reduceFloor(rolled, action, phase)(rolled.floor), binds: reduceBinds(rolled, action, phase)(next.binds) }
  return settleSevered(rolled, action.id)(settleBinds(phase === 'resolve' ? settleArcs(placed) : placed))
}

// spells.tex "Sustained Lightning": an arc that breaks ends its spell, and a
// touch short-circuits it onto both ends. Read where each action leaves the
// board; a broken arc does not come back, it is cast again.
function settleArcs(state: SceneState): SceneState {
  const broken = getBrokenArcs(state)
  if (broken.length === 0) return state
  return mapCharacters(state, (c) => {
    const released = broken.filter((b) => b.casterId === c.id).reduce((acc, b) => releaseSpell(b.key)(acc), c)
    return deliverAll(broken.filter((b) => b.casterId === c.id || b.targetId === c.id).flatMap((b) => b.shock))(released)
  })
}

// The open action while it is at the step; null otherwise.
export function getOpenAt(state: SceneState, step: Action['step']): RootAction | null {
  const open = getOpenAction(state)
  return open && open.step === step ? open : null
}

// The open action while reactions to it can still be declared or taken
// back; null otherwise.
export function getAnswerableOpen(state: SceneState): RootAction | null {
  const open = getOpenAction(state)
  return open && isAnswerable(state, open) ? open : null
}

// Drops every reaction to the open action that its triggers no longer
// offer, as its declaration changes.
export function pruneReactions(state: SceneState): SceneState {
  const open = getOpenAt(state, 'react')
  if (!open) return state
  const live = getLiveReactionsTo(state, open.id)
  const dropped = live.filter((a) => findTrigger(state, open, { ...a, at: a.kind === 'opportunityAttack' || a.kind === 'retarget' || a.kind === 'flee' ? a.at : undefined }) === null)
  return withdrawActions(state, dropped.map((a) => a.id), 'noLongerTriggered')
}

// The open action, once rolled, when it is of one of the kinds; null
// otherwise — what every choice made after the die starts from.
export function getRolledOpen<K extends ActionKind>(state: SceneState, kinds: readonly K[]): ActionOf<K> | null {
  const open = getOpenAction(state)
  return open && open.step === 'post' && (kinds as readonly ActionKind[]).includes(open.kind) ? open as ActionOf<K> : null
}
