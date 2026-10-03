import type { Action, ActionRoll, Change, CombatState, CostTerm, JournalEntry, MoveAction, MoveFacts, MoveStop } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getActionName } from './labels'
import { getActionReport, type ActionReport } from './outcomes'
import { ACTIONS } from '../rules/actionCatalog'
import { getFightName } from '../rules/fighters'
import { getAction, getHistory, getOrigin, getReactionsTo } from '../rules/log'
import { getGivenUpFor, isInterruptible, isVoided } from '../rules/opportunity'
import { getInterruptions } from '../rules/interruption'
import { getMoveOverride } from '../rules/move'

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
  surged: Action['surged']
  roll: ActionRoll | null
  changes: string[]
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
  surged: Action['surged']
  // what its roll and its landing changed, a line each
  changes: string[]
  // how it came to be played, when not on its actor's own initiative
  cause: string | null
  // why it came to less than it was declared as, when it did
  fate: string | null
  reactions: ReactionLine[]
  withdrawn: WithdrawnLine[]
}

// The last chain of actions to be played out, in the order its actions
// landed; null before anything has.
export function getLastEpisode(state: CombatState): EpisodeEntry[] | null {
  const last = getHistory(state).at(-1)
  const landed = last ? getAction(state, last) : null
  if (!landed) return null
  const origin = getOrigin(state, landed).id
  const roots = state.record.filter((a) => a.reactionTo === null && getOrigin(state, a).id === origin)
  const rootIds = new Set(roots.map((a) => a.id))
  const entries = roots.flatMap((a) => {
    const report = getActionReport(state, a.id)
    return report ? [{ ...report, rule: ACTIONS[a.kind].rule, cost: a.cost, costTerms: a.costTerms, surged: a.surged, changes: a.changes.map((c) => describeChange(state, c)), cause: getCause(state, a), fate: getFate(state, a), reactions: getReactionLines(state, a), withdrawn: getWithdrawn(state, a.id, rootIds) }] : []
  })
  return entries.length > 0 ? entries : null
}

// What was withdrawn that belongs to the landed action: an answer taken back
// from it, a follow-up it left that was passed up, whatever either had
// opened.
function getWithdrawn(state: CombatState, rootId: string, rootIds: Set<string>): WithdrawnLine[] {
  return state.journal
    .filter((entry) => getLandedParent(state, entry.action, rootIds) === rootId)
    .map((entry) => ({ text: describeWithdrawal(state, entry), surged: entry.action.surged }))
}

// The landed action of the episode the withdrawn one hangs from, found up its
// links through what is still in play and what was itself withdrawn.
function getLandedParent(state: CombatState, action: Action, rootIds: Set<string>): string | null {
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

function describeWithdrawal(state: CombatState, { action, reason }: JournalEntry): string {
  const actor = getFightName(state, action.actorId)
  const what = getActionName(action)
  switch (reason) {
    case 'tookBack': return `${actor} took back ${what}`
    case 'replaced': return `${actor} changed ${what} for another answer`
    case 'passedUp': return `${actor} passed up ${what}`
    case 'forgone': return `${actor} did not take ${what}: they took another follow-up of the same action`
    case 'noLongerTriggered': return `${actor}'s ${what} no longer applied once the action it answered changed`
  }
}

function getReactionLines(state: CombatState, root: Action): ReactionLine[] {
  return getReactionsTo(state, root.id)
    .filter((r) => r.step === 'done')
    .map((r) => ({ actor: getFightName(state, r.actorId), label: getActionName(r), rule: ACTIONS[r.kind].rule, cost: r.cost, costTerms: r.costTerms, surged: r.surged, roll: r.roll, changes: r.changes.map((c) => describeChange(state, c)) }))
}

function describe(state: CombatState, action: Action): string {
  return `${getFightName(state, action.actorId)}'s ${getActionName(action)}`
}

function getCause(state: CombatState, action: Action): string | null {
  const opener = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  if (opener) return `opened by ${describe(state, opener)}`
  const earlier = action.followUpOf ? getAction(state, action.followUpOf) : null
  return earlier ? `follow-up to ${describe(state, earlier)}` : null
}

function getFate(state: CombatState, action: Action): string | null {
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

function getMoveFate(state: CombatState, move: MoveAction): string | null {
  if (!move.facts) return null
  const reason = STOP_REASON[move.facts.stop](getStopCause(state, move, move.facts))
  return reason ? `walked ${move.facts.path.length} of ${move.path.length} steps: ${reason}` : null
}

// Who or what stopped the move: the character whose passage was blocked, or
// the action of an opportunity attack that cut it short.
function getStopCause(state: CombatState, move: MoveAction, facts: MoveFacts): string | null {
  const blocked = facts.stop === 'trample' ? facts.trampled.find((t) => t.result === 'blocked') : undefined
  if (blocked) return getFightName(state, blocked.id)
  const by = getMoveOverride(state, move)?.by
  return by ? describe(state, by) : null
}

function describeChange(state: CombatState, change: Change): string {
  const who = getFightName(state, change.id)
  switch (change.kind) {
    case 'value': return `${who}: ${change.what} ${change.from} → ${change.to}`
    case 'gain': return `${who}: ${change.gained ? 'gained' : 'lost'} ${change.what} ${change.name}`
    case 'move': return `${change.name}: ${change.from} → ${change.to}`
  }
}
