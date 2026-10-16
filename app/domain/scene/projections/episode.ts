import type { Action, ActionRoll, Change, SceneState, CostTerm, Detection, JournalEntry, MoveAction, MoveFacts, MoveStop } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { getActionName } from './labels'
import { getActionReport, type ActionReport } from './outcomes'
import { ACTIONS } from '../rules/actionCatalog'
import { getFightName } from '../rules/fighters'
import { getAction, getHistory, getLanded, getOrigin, getReactionsTo } from '../rules/log'
import { getGivenUpFor, isInterruptible, isVoided } from '../rules/opportunity'
import { getInterruptions } from '../rules/interruption'
import { getMoveOverride } from '../rules/move'
import { describeOutcome } from '../../play/test'

// What the table reads once an action has played out, whole: the action that
// started it and everything it drew — the answers given to it, what those
// opened, the follow-ups it left — each as it landed, with what it cost and,
// where it came to less than it was declared as, why.

export type ReactionLine = {
  actor: string
  label: string
  rule: string
  cost: ActionCost | null
  costTerms: CostTerm[]
  refunded: number
  surged: Action['surged']
  roll: ActionRoll | null
  changes: string[]
}

export type DetectionLine = {
  text: string
  terms: Term[]
}

// Something committed or offered that left play without landing, and why.
export type WithdrawnLine = {
  text: string
  surged: Action['surged']
}

export type EpisodeEntry = ActionReport & {
  // where the book says it
  rule: string
  cost: ActionCost | null
  costTerms: CostTerm[]
  refunded: number
  surged: Action['surged']
  // what its roll and its landing changed, a line each
  changes: string[]
  // how it came to be played, when not on its actor's own initiative
  cause: string | null
  // whom its actor began their turn undetected by, for one taken in that turn
  hiddenFrom: string | null
  // the detection tests made as it was committed, and who could not sense its
  // actor at all, a line each with the terms the detection was added up from
  detections: DetectionLine[]
  // why it came to less than it was declared as, when it did
  fate: string | null
  reactions: ReactionLine[]
  withdrawn: WithdrawnLine[]
}

// The last chain of actions to be played out, in the order its actions
// landed; null before anything has.
export function getLastEpisode(state: SceneState): EpisodeEntry[] | null {
  const last = getHistory(state).at(-1)
  const landed = last ? getAction(state, last) : null
  return landed ? getEpisode(state, getOrigin(state, landed).id) : null
}

// Every chain of actions that began this round, newest first, each in the
// order its actions landed.
export function getRoundEpisodes(state: SceneState): EpisodeEntry[][] {
  return getOrigins(state).filter((o) => o.round === state.round).map((o) => o.id).reverse().flatMap((origin) => {
    const episode = getEpisode(state, origin)
    return episode ? [episode] : []
  })
}

// The whole fight, a line for each action played out — who did what, how
// it rolled and what it came to — and an indented one for each answer to it;
// from `since` on, only what landed after the first `since` of `landed`.
export function getFightLogLines(state: SceneState, since = 0): string[] {
  return getOrigins(state, since).flatMap((origin) => (getEpisode(state, origin.id, since) ?? []).flatMap((entry) => [
    `round ${origin.round} · ${entry.actor} · ${entry.label}${describeOutcome(entry.roll)}${entry.outcomes.map((o) => ` · ${o.target}${o.outcome.tier !== null ? ` T${o.outcome.tier}` : ''}${o.outcome.dead ? ' dead' : ''}`).join('')}`,
    ...entry.reactions.map((r) => `  ${r.actor} answered: ${r.label}${describeOutcome(r.roll)}`),
    ...(entry.fate ? [`  ${entry.fate}`] : []),
  ]))
}

// The action each chain played out began with, in the order they landed.
function getOrigins(state: SceneState, since = 0): Action[] {
  return [...new Map(getLanded(state).slice(since).filter((a) => a.reactionTo === null).map((a) => getOrigin(state, a)).map((o) => [o.id, o])).values()]
}

function getEpisode(state: SceneState, origin: string, since = 0): EpisodeEntry[] | null {
  const roots = getLanded(state).slice(since).filter((a) => a.reactionTo === null && getOrigin(state, a).id === origin)
  const rootIds = new Set(roots.map((a) => a.id))
  const entries = roots.flatMap((a) => {
    const report = getActionReport(state, a.id)
    return report ? [{ ...report, rule: ACTIONS[a.kind].rule, cost: a.cost, costTerms: a.costTerms, refunded: a.refunded, surged: a.surged, changes: a.changes.map((c) => describeChange(state, c)), cause: getCause(state, a), hiddenFrom: describeHiddenFrom(state, a), detections: a.detections.map((d) => describeDetection(state, d)), fate: getFate(state, a), reactions: getReactionLines(state, a), withdrawn: getWithdrawn(state, a.id, rootIds) }] : []
  })
  return entries.length > 0 ? entries : null
}

// What was withdrawn that belongs to the landed action: an answer taken back
// from it, a follow-up it left that was passed up, whatever either had
// opened.
function getWithdrawn(state: SceneState, rootId: string, rootIds: Set<string>): WithdrawnLine[] {
  return state.journal
    .filter((entry) => getLandedParent(state, entry.action, rootIds) === rootId)
    .map((entry) => ({ text: describeWithdrawal(state, entry), surged: entry.action.surged }))
}

// The landed action of the episode the withdrawn one hangs from, found up its
// links through what is still in play and what was itself withdrawn.
function getLandedParent(state: SceneState, action: Action, rootIds: Set<string>): string | null {
  const seen = new Set([action.id])
  let current = action
  for (;;) {
    const parentId = current.reactionTo ?? current.spawnedBy ?? current.followUpOf
    if (!parentId || seen.has(parentId)) return null
    if (rootIds.has(parentId)) return parentId
    const parent = getAction(state, parentId) ?? state.journal.find((j) => j.action.id === parentId)?.action
    if (!parent) return null
    seen.add(parentId)
    current = parent
  }
}

function describeWithdrawal(state: SceneState, { action, reason }: JournalEntry): string {
  const actor = getFightName(state, action.actorId)
  const what = getActionName(action)
  switch (reason) {
    case 'tookBack': return `${actor} took back ${what}`
    case 'replaced': return `${actor} changed ${what} for another answer`
    case 'passedUp': return `${actor} passed up ${what}`
    case 'forgone': return `${actor} did not take ${what}: they took another follow-up of the same action`
    case 'noLongerTriggered': return `${actor}'s ${what} no longer applied once the action it answered changed`
    case 'givenUp': return `${actor} gave up ${what}, held over from the round before, to defend`
    case 'interrupted': return `${actor}'s ${what}, held over, was interrupted: what was spent on it is lost`
    case 'failed': return `${actor}'s ${what}, held over, failed for want of what it needed when it came to finish`
    case 'cancelledByGM': return `the GM cancelled ${actor}'s ${what} while it waited on their die`
  }
}

function describeHiddenFrom(state: SceneState, action: Action): string | null {
  if (!action.hiddenFrom) return null
  const names = action.hiddenFrom.map((id) => getFightName(state, id))
  return `${getFightName(state, action.actorId)} began the turn hidden from ${names.length > 0 ? names.join(', ') : 'nobody'}`
}

// combat.tex "Stealth in combat": the hider's stealth value, less what their
// turn had spent, against the observer's detection.
function describeDetection(state: SceneState, { observerId, hiderId, found, test }: Detection): DetectionLine {
  const observer = getFightName(state, observerId)
  const hider = getFightName(state, hiderId)
  if (!test) return { text: `${observer} could not sense ${hider}`, terms: [] }
  const score = test.penalty ? `stealth ${test.score} − ${test.penalty} for the turn = ${test.score - test.penalty}` : `stealth ${test.score}`
  return { text: `${observer} ${found ? 'noticed' : 'did not notice'} ${hider}: ${score} vs ${test.sense} detection ${test.detection} · ${test.degree}`, terms: test.terms }
}

function getReactionLines(state: SceneState, root: Action): ReactionLine[] {
  return getReactionsTo(state, root.id)
    .filter((r) => r.step === 'done')
    .map((r) => ({ actor: getFightName(state, r.actorId), label: getActionName(r), rule: ACTIONS[r.kind].rule, cost: r.cost, costTerms: r.costTerms, refunded: r.refunded, surged: r.surged, roll: r.roll, changes: r.changes.map((c) => describeChange(state, c)) }))
}

function describe(state: SceneState, action: Action): string {
  return `${getFightName(state, action.actorId)}'s ${getActionName(action)}`
}

function getCause(state: SceneState, action: Action): string | null {
  const opener = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  if (opener) return `opened by ${describe(state, opener)}`
  const earlier = action.followUpOf ? getAction(state, action.followUpOf) : null
  return earlier ? `follow-up to ${describe(state, earlier)}` : null
}

function getFate(state: SceneState, action: Action): string | null {
  if (action.kind === 'move') return getMoveFate(state, action)
  if (!isVoided(state, action)) return null
  const actor = getFightName(state, action.actorId)
  const given = isInterruptible(action) ? getGivenUpFor(state, action) : null
  if (given) return `given up: ${actor} answered ${describe(state, given)} instead`
  const hit = getInterruptions(state, action)[0]
  return hit ? `broken: ${describe(state, hit.by)} ${hit.level} ${actor} before it took effect` : null
}

// combat.tex "Interruption", "Crash", "Flee", "Evasive Jump"
const STOP_REASON: Record<MoveStop, (by: string | null) => string | null> = {
  end: () => null,
  reaction: (by) => (by ? `interrupted by ${by}` : 'interrupted'),
  jump: (by) => (by ? `jumped away from ${by}` : 'jumped away'),
  fall: () => 'fell on difficult ground',
  trample: (by) => (by ? `blocked by ${by}` : 'blocked'),
  flee: () => 'someone fled it',
}

function getMoveFate(state: SceneState, move: MoveAction): string | null {
  if (!move.facts) return null
  const reason = STOP_REASON[move.facts.stop](getStopCause(state, move, move.facts))
  return reason ? `walked ${move.facts.path.length} of ${move.path.length} steps: ${reason}` : null
}

// Who or what stopped the move: the character whose passage was blocked, or
// the action of an opportunity attack that cut it short.
function getStopCause(state: SceneState, move: MoveAction, facts: MoveFacts): string | null {
  const blocked = facts.stop === 'trample' ? facts.trampled.find((t) => t.result === 'blocked') : undefined
  if (blocked) return getFightName(state, blocked.id)
  const by = getMoveOverride(state, move)?.by
  return by ? describe(state, by) : null
}

export function describeChange(state: SceneState, change: Change): string {
  return `${change.kind === 'move' ? change.name : getFightName(state, change.id)}: ${describeChangeTo(change)}`
}

// What the change did, leaving out whom or what it was done to.
export function describeChangeTo(change: Change): string {
  switch (change.kind) {
    case 'value': return `${change.what} ${change.from} → ${change.to}`
    case 'gain': return `${change.gained ? 'gained' : 'lost'} ${change.what} ${change.name}`
    case 'move': return `${change.from} → ${change.to}`
  }
}

// What commands outside any action changed since the last action landed, a
// line each.
export function getEditsSince(state: SceneState): string[] {
  return state.edits
    .filter((e) => e.landed >= state.landed.length)
    .flatMap((e) => e.changes.map((c) => `${e.cause}: ${describeChange(state, c)}`))
}
