import { LIMIT_STRESS_ACTIONS, type LimitStressAction } from '../../lists'
import type { CampaignCharacter, Grant } from '../../types'
import { getFightCunningTerms } from './centralIntelligence'
import type { Action, Compulsion, Domination, SceneState } from '../types'
import type { Test } from '../../play/test'
import { ABILITIES } from '../../abilities'
import { getGrantingAbility } from '../../character/rules/effects'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { canAfford, NOT_ENOUGH_AP } from '../../character/rules/cost'
import { skillTermGetters } from '../../character/rules/skills'
import { sumTerms } from '../../character/rules/terms'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getAction, getHistory, getOpenAction } from './log'
import { getSituationalAfflictions } from './situational'
import { getStressTurn } from './stress'
import { isCombatStarted } from './started'
import { getFightName } from './fighters'

// The Domination abilities (abilities.tex "Domination") that work on the
// fight: Overrule and Subjugate on a limit stress action, the domination
// Subjugate leaves and breaking out of it, and Mockery.

// ---------------------------------------------------------------------------
// Overrule and Subjugate

// What the orders are: the limit stress action given in place of the one
// activated ("Overrule", the table's ruling: picked as Suggestion picks), or
// a command the target is dominated under ("Subjugate").
export type Order = LimitStressAction | 'dominate'

const ORDER_GRANT = (order: Order): Grant => (order === 'dominate' ? 'subjugate' : 'overrule')

// What giving the order costs the character, by the catalog entry of the
// ability that lets them, or null when none does.
export function getOrderCost(c: CampaignCharacter, order: Order): ActionCost | null {
  const key = getGrantingAbility(c, ORDER_GRANT(order))
  return key ? { AP: ABILITIES[key].cost.AP, STA: ABILITIES[key].cost.STA } : null
}

// The limit stress action the target owes that may still be overruled, or
// null: one the round's morale test activated ("This cannot be used to stop
// magical effects"), not overruled yet, and not yet acted on (the surge it
// compels not made, the social action not said).
export function getOverrulable(state: SceneState, targetId: string): Compulsion | null {
  const turn = state.compulsions.find((t) => t.id === targetId && !t.taken) ?? null
  const c = state.characters[targetId]
  if (!turn || !c || turn.by !== '' || turn.overruledBy !== '' || turn.acted) return null
  return getStressTurn(state)?.id === targetId && c.usedSurge !== null ? null : turn
}

// Why the character cannot give the target the order now, or null.
export function getOrderBar(state: SceneState, by: string, targetId: string, order: Order): string | null {
  const c = state.characters[by]
  const target = state.characters[targetId]
  if (!c || !target || isDead(c) || isDead(target)) return 'not in the fight'
  if (by === targetId) return 'not to oneself'
  const cost = getOrderCost(c, order)
  if (!cost) return order === 'dominate' ? 'has not learned Subjugate' : 'has not learned Overrule'
  if (hasAffliction(c, 'unconscious', getSituationalAfflictions(state, by))) return 'unconscious'
  const turn = state.compulsions.find((t) => t.id === targetId && !t.taken)
  if (!turn) return 'no limit stress action to overrule'
  if (turn.by !== '') return 'a spell compels it'
  if (!getOverrulable(state, targetId)) return turn.overruledBy !== '' ? 'already overruled' : 'already acted on'
  if (turn.contested.includes(by)) return 'already tried'
  if (order === turn.action) return `already ${order}`
  return canAfford(c, cost, isCombatStarted(state)) ? null : NOT_ENOUGH_AP
}

// abilities.tex "Overrule": "a persuasion or deception vs will test": the
// better of the character's two against the target's will as the DL, which
// the target does not roll (the table's ruling).
export function getOrderTest(state: SceneState, by: string, targetId: string): Test | null {
  const c = state.characters[by]
  const target = state.characters[targetId]
  if (!c || !target) return null
  const own = getSituationalAfflictions(state, by)
  const skill = Math.max(sumTerms(skillTermGetters.persuasion(c, own)), sumTerms(skillTermGetters.deception(c, own)))
  return { skill, DL: sumTerms(skillTermGetters.will(target, getSituationalAfflictions(state, targetId))), explodes: false, scale: 'degrees' }
}

// The orders the character could give the target now, each with why not.
export type OrderOption = { order: Order; bar: string | null }

export function getOrderOptions(state: SceneState, by: string, targetId: string): OrderOption[] {
  const c = state.characters[by]
  if (!c) return []
  const orders: Order[] = [...(getOrderCost(c, 'coward') ? LIMIT_STRESS_ACTIONS : []), ...(getOrderCost(c, 'dominate') ? (['dominate'] as const) : [])]
  return orders.map((order) => ({ order, bar: getOrderBar(state, by, targetId, order) }))
}

// ---------------------------------------------------------------------------
// Dominated

// combat.tex "Dominated": the domination the character is under, while they
// stay dominated and whoever dominates them is in the fight, or null.
export function getDomination(state: SceneState, id: string): Domination | null {
  const c = state.characters[id]
  const d = state.dominations.find((x) => x.id === id)
  const by = d ? state.characters[d.by] : undefined
  return c && d && by && !isDead(by) && hasAffliction(c, 'dominated') ? d : null
}

// Who plays the character: whoever dominates them ("Under the control of
// another character"), else themselves.
export function getControllerId(state: SceneState, id: string): string {
  return getDomination(state, id)?.by ?? id
}

// combat.tex "Dominated": "an Insight or Cunning test against the original
// DL", the better of the two; the cunning a linked caster lends counts
// (abilities.tex "Central Intelligence").
export function getBreakFreeTest(state: SceneState, id: string): Test | null {
  const c = state.characters[id]
  const d = getDomination(state, id)
  if (!c || !d) return null
  const own = getSituationalAfflictions(state, id)
  const skill = Math.max(sumTerms(skillTermGetters.insight(c, own)), sumTerms(getFightCunningTerms(state, id)))
  return { skill, DL: d.DL, explodes: false, scale: 'degrees' }
}

// Why the character cannot test to break out now, or null. The test is made
// "whenever a command constitutes a severe compulsion", which is the GM's
// to judge.
export function getBreakFreeBar(state: SceneState, id: string): string | null {
  return getDomination(state, id) ? null : 'not dominated'
}

// A line for the character's card: whom they are dominated by.
export function getDominationLine(state: SceneState, id: string): string | null {
  const d = getDomination(state, id)
  return d ? `dominated by ${getFightName(state, d.by)} (DL ${d.DL})` : null
}

// ---------------------------------------------------------------------------
// Mockery

// abilities.tex "Mockery": "Any time you crit in any action against someone
// in combat or when they miss in one": the action played out last this
// round, nothing being played out since (the table's ruling: until the next
// action starts), the mocker's crit against someone or someone's miss
// against the mocker. A spell's test is its target's die, so it is neither.
// The one to mock, or null.
export function getMockable(state: SceneState, mocker: string): { action: Action; targetId: string } | null {
  const last = getHistory(state).at(-1)
  const action = last ? getAction(state, last) : null
  if (!action || !action.roll || !action.targetId || action.round !== state.round || action.kind === 'spellTest' || getOpenAction(state)) return null
  if (state.mocked.includes(action.id)) return null
  const crit = action.roll.degree === 'critical' || action.roll.HOP >= 5
  if (action.actorId === mocker && crit && state.characters[action.targetId]) return { action, targetId: action.targetId }
  if (action.targetId === mocker && action.actorId !== mocker && action.roll.degree === 'miss' && state.characters[action.actorId]) return { action, targetId: action.actorId }
  return null
}

// What a mock costs the character, by the catalog entry, or null when they
// have not learned Mockery.
export function getMockeryCost(c: CampaignCharacter): ActionCost | null {
  const key = getGrantingAbility(c, 'mockery')
  return key ? { AP: ABILITIES[key].cost.AP, STA: ABILITIES[key].cost.STA } : null
}

// abilities.tex "Mockery": "gets +1 to the provocation test".
export const MOCKERY_BONUS = 1

// Why the character cannot mock now, or null.
export function getMockeryBar(state: SceneState, mocker: string): string | null {
  const c = state.characters[mocker]
  const cost = c ? getMockeryCost(c) : null
  if (!c || !cost) return 'has not learned Mockery'
  if (isDead(c) || hasAffliction(c, 'unconscious', getSituationalAfflictions(state, mocker))) return 'unconscious'
  if (!getMockable(state, mocker)) return 'nothing to mock: a crit against someone, or a miss against them, just now'
  return canAfford(c, cost, isCombatStarted(state)) ? null : NOT_ENOUGH_AP
}
