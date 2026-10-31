import type { Action, PrepareAction, SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import type { Term } from '../../character/rules/terms'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import { getGrantCount, hasGrant } from '../../character/rules/effects'
import { getAction, getRootOf } from './log'
import { getPrepared, getPreparationOf, getPreparationWithin } from './prepared'
import { getPerformerId } from './performer'

// The Cunning abilities (abilities.json, section "Cunning") that work on the
// fight as it stands: what a test gets, what a preparation costs, and what a
// prepared action gives back. Battle Commands is who a preparation is made by
// (rules/performer.ts), Prepared the price of the action it is for
// (rules/prepared.ts `getPreparedDiscount`), Reactive Fighting the reaction
// surge (character/rules/surge.ts).

// ---------------------------------------------------------------------------
// What a test gets

// What the root's own test gets: Deliberate on the prepared action it is, and
// Initiative Edge and Improved Feint against whoever it is aimed at.
export function getCunningTestTerms(state: SceneState, root: Action): Term[] {
  const opener = root.spawnedBy ? getAction(state, root.spawnedBy) : null
  return [
    ...getDeliberateTerms(state, root),
    ...getEdgeTerms(state, root.actorId, root.targetId, opener?.reactionTo != null),
  ]
}

// What a reaction puts up against the action it answers: Deliberate on a
// defense made as one prepared, and Initiative Edge and Improved Feint against
// whoever made that action.
export function getCunningReactionTerms(state: SceneState, reaction: Action): Term[] {
  const answered = reaction.reactionTo ? getRootOf(state, reaction) : null
  return [
    ...getDeliberateTerms(state, reaction),
    ...getEdgeTerms(state, reaction.actorId, answered?.actorId ?? null, true),
  ]
}

// abilities.json "Deliberate": "Prepared actions gain +1|2 on the test of the
// prepared action", by its preparer's level, whoever makes it (the table's
// ruling: a command is made with its commander's abilities).
function getDeliberateTerms(state: SceneState, action: Action): Term[] {
  const p = getPreparationOf(state, action)
  const preparer = p ? state.characters[p.actorId] : undefined
  const level = preparer ? getGrantCount(preparer, 'deliberate') : 0
  return level > 0 ? [{ label: 'Deliberate', value: level }] : []
}

// What the actor's test against the other gets for the turn it is made in.
// abilities.json "Initiative Edge": "Whenever you win a cunning test to act
// before another character, you gain +1 in all skill tests against that
// character on your turn": the contest for the turn, against everyone who
// rolled under the winner (the table's ruling: only a turn won by cunning).
// "Improved Feint": "After feinting a character successfully, gains +1 in
// every reaction against them on the provoked turn."
function getEdgeTerms(state: SceneState, actorId: string, againstId: string | null, reacting: boolean): Term[] {
  const actor = state.characters[actorId]
  if (!actor || !againstId || againstId === actorId) return []
  return [
    ...(hasInitiativeEdge(state, actor, againstId) ? [{ label: 'Initiative Edge', value: 1 }] : []),
    ...(reacting && hasFeintEdge(state, actor, againstId) ? [{ label: 'Improved Feint', value: 1 }] : []),
  ]
}

function hasInitiativeEdge(state: SceneState, actor: CampaignCharacter, againstId: string): boolean {
  const contest = state.lastContest
  if (!contest || contest.winner !== actor.id || state.inTurnCharacter !== actor.id || !hasGrant(actor, 'initiativeEdge')) return false
  const won = contest.rolls.find((r) => r.id === actor.id)
  const lost = contest.rolls.find((r) => r.id === againstId)
  return !!won && !!lost && lost.score < won.score
}

function hasFeintEdge(state: SceneState, actor: CampaignCharacter, againstId: string): boolean {
  return state.forcedBy === actor.id && state.forcedSurge === againstId && state.inTurnCharacter === againstId && hasGrant(actor, 'improvedFeint')
}

// ---------------------------------------------------------------------------
// What a preparation costs

// What preparing costs the character now: the table's price, or nothing
// where Strategist makes it free.
export function getPrepareCost(state: SceneState, c: CampaignCharacter, id = ''): ActionCost {
  const cost = getActionCost(c, 'prepare')
  return { ...cost, AP: cost.AP - getStrategistDiscount(state, c, id, cost.AP) }
}

// abilities.json "Strategist": "If the character is the first to take their
// turn in a round in combat, they can prepare an action|two actions for
// free": the first one or two they prepare in the round, a command among
// them. `id` is the preparation being priced, never counted against itself.
export function getStrategistDiscount(state: SceneState, c: CampaignCharacter, id: string, AP: number): number {
  if (state.firstTurn?.id !== c.id) return 0
  const made = getPrepared(state).filter((p) => p.actorId === c.id && p.id !== id).length
  return made < getGrantCount(c, 'strategist') ? Math.max(0, AP) : 0
}

// ---------------------------------------------------------------------------
// What a prepared action gives back

// abilities.json "Perfect Preparation": "Receives +1 AP for each crit in the
// prepared action, or when an attack has 5 HOPs or more": every test its
// performer rolls in it, the action and what it opens, a critical or 5 HOP
// (left to be spent); the tests held for the round (a balance, a climb, a
// swim) are not counted (the table's ruling). The AP go to its preparer.
export function getPreparationAP(state: SceneState, rolled: Action): { to: string; AP: number } | null {
  if (!rolled.roll || rolled.kind === 'move' || rolled.kind === 'swimTest') return null
  const p: PrepareAction | null = getPreparationWithin(state, rolled)
  if (!p || rolled.actorId !== getPerformerId(p)) return null
  const preparer = state.characters[p.actorId]
  if (!preparer || !hasGrant(preparer, 'perfectPreparation')) return null
  return rolled.roll.degree === 'critical' || rolled.roll.HOP >= 5 ? { to: p.actorId, AP: 1 } : null
}
