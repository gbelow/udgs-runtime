import type { Action, ActionRoll, CombatState, CostTerm, MoveAction, MoveFacts, MoveStop } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getActionName } from './labels'
import { getActionReport, type ActionReport } from './outcomes'
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
  cost: ActionCost | null
  costTerms: CostTerm[]
  surged: Action['surged']
  roll: ActionRoll | null
}

export type EpisodeEntry = ActionReport & {
  cost: ActionCost | null
  costTerms: CostTerm[]
  surged: Action['surged']
  // how it came to be played, when not on its actor's own initiative
  cause: string | null
  // why it came to less than it was declared as, when it did
  fate: string | null
  reactions: ReactionLine[]
}

// The last chain of actions to be played out, in the order its actions
// landed; null before anything has.
export function getLastEpisode(state: CombatState): EpisodeEntry[] | null {
  const last = getHistory(state).at(-1)
  const landed = last ? getAction(state, last) : null
  if (!landed) return null
  const origin = getOrigin(state, landed).id
  const entries = state.record
    .filter((a) => a.reactionTo === null && getOrigin(state, a).id === origin)
    .flatMap((a) => {
      const report = getActionReport(state, a.id)
      return report ? [{ ...report, cost: a.cost, costTerms: a.costTerms, surged: a.surged, cause: getCause(state, a), fate: getFate(state, a), reactions: getReactionLines(state, a) }] : []
    })
  return entries.length > 0 ? entries : null
}

function getReactionLines(state: CombatState, root: Action): ReactionLine[] {
  return getReactionsTo(state, root.id)
    .filter((r) => r.step === 'done')
    .map((r) => ({ actor: getFightName(state, r.actorId), label: getActionName(r), cost: r.cost, costTerms: r.costTerms, surged: r.surged, roll: r.roll }))
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
