import type { Action, PrepareAction, SceneState } from '../types'
import type { CampaignCharacter, EdgeRecipe } from '../../types'
import type { Term } from '../../character/rules/terms'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import { getGrantCount, getLearnedAbilities, hasGrant } from '../../character/rules/effects'
import { getAction, getRootOf } from './log'
import { getPrepared, getPreparationOf, getPreparationWithin } from './prepared'
import { getPerformerId } from './performer'
import { getPressingFactors } from './morale'
import { isFragile } from './fragile'

// The Cunning abilities (abilities.json, section "Cunning") that work on the
// fight as it stands: what a test gets, what a preparation costs, and what a
// prepared action gives back. Battle Commands is who a preparation is made by
// (rules/performer.ts), Prepared the price of the action it is for
// (rules/prepared.ts `getPreparedDiscount`), Reactive Fighting the reaction
// surge (character/rules/surge.ts).

// ---------------------------------------------------------------------------
// What a test gets

// What the root's own test gets against whoever it is aimed at.
export function getCunningTestTerms(state: SceneState, root: Action): Term[] {
  const opener = root.spawnedBy ? getAction(state, root.spawnedBy) : null
  return getEdgeTerms(state, root, root.targetId, opener?.reactionTo != null)
}

// What a reaction puts up against the action it answers, against whoever
// made that action.
export function getCunningReactionTerms(state: SceneState, reaction: Action): Term[] {
  const answered = reaction.reactionTo ? getRootOf(state, reaction) : null
  return getEdgeTerms(state, reaction, answered?.actorId ?? null, true)
}

// The holder whose edges of the situation count for the test, or null when
// the situation does not hold.
// abilities.json "Deliberate": "Prepared actions gain +1|2 on the test of the
// prepared action": its preparer's, whoever makes it (the table's ruling: a
// command is made with its commander's abilities).
// "Initiative Edge": "Whenever you win a cunning test to act before another
// character, you gain +1 in all skill tests against that character on your
// turn": the contest for the turn, against everyone who rolled under the
// winner (the table's ruling: only a turn won by cunning).
// "Improved Feint": "After feinting a character successfully, gains +1 in
// every reaction against them on the provoked turn."
// abilities.tex "Grace Under Pressure": "+1 to all skills in any turn when
// the morale test aggravating factors are equal or higher than 5": the
// actor's, as the fight weighs on them when they test, a rally left out
// (the table's ruling).
// abilities.tex "Bulwark": "+1|2 to defend and reflex when making the
// protection surge to protect someone else": every defense and reflex made
// once the surge is (the table's ruling).
// abilities.tex "Exploit Weakness": "+1 to all tests against characters
// affected by any mind altering status effects" (rules/fragile.ts).
const EDGE_HOLDER: Record<EdgeRecipe['when'], (state: SceneState, action: Action, againstId: string | null) => CampaignCharacter | null> = {
  prepared: (state, action) => {
    const p = getPreparationOf(state, action)
    return (p && state.characters[p.actorId]) ?? null
  },
  wonCunning: (state, action, againstId) => {
    const actor = getAgainst(state, action, againstId)
    const contest = state.lastContest
    if (!actor || !againstId || !contest || contest.winner !== actor.id || state.inTurnCharacter !== actor.id) return null
    const won = contest.rolls.find((r) => r.id === actor.id)
    const lost = contest.rolls.find((r) => r.id === againstId)
    return won && lost && lost.score < won.score ? actor : null
  },
  feinted: (state, action, againstId) => {
    const actor = getAgainst(state, action, againstId)
    return actor && state.forcedBy === actor.id && state.forcedSurge === againstId && state.inTurnCharacter === againstId ? actor : null
  },
  underPressure: (state, action) => {
    const actor = state.characters[action.actorId]
    return actor && getPressingFactors(state, action.actorId) >= 5 ? actor : null
  },
  fragile: (state, action, againstId) => {
    const actor = getAgainst(state, action, againstId)
    return actor && againstId && isFragile(state, againstId) ? actor : null
  },
  protecting: (state, action) => {
    const actor = state.characters[action.actorId]
    return actor && actor.usedSurge === 'protection' && action.reactionTo !== null ? actor : null
  },
}

// The actor of a test made against someone else.
function getAgainst(state: SceneState, action: Action, againstId: string | null): CampaignCharacter | null {
  return againstId && againstId !== action.actorId ? state.characters[action.actorId] ?? null : null
}

// What the test gets from every edge whose situation holds, one line per
// ability, by the holder's learned abilities.
function getEdgeTerms(state: SceneState, action: Action, againstId: string | null, reacting: boolean): Term[] {
  const lines = new Map<string, number>()
  for (const when of Object.keys(EDGE_HOLDER) as EdgeRecipe['when'][]) {
    const holder = EDGE_HOLDER[when](state, action, againstId)
    if (!holder) continue
    for (const ability of getLearnedAbilities(holder)) {
      for (const r of ability.recipes) {
        if (r.type === 'edge' && r.when === when && (r.tests === 'all' || reacting)) lines.set(ability.family, (lines.get(ability.family) ?? 0) + r.hit)
      }
    }
  }
  return [...lines].map(([label, value]) => ({ label, value }))
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
// swim) are not counted (the table's ruling). The crit is its preparer's, and
// so are the AP; the Stoic's attitude counts the same crits. The preparer's
// id, or null.
export function getPreparedCrit(state: SceneState, rolled: Action): string | null {
  if (!rolled.roll || rolled.kind === 'move' || rolled.kind === 'swimTest') return null
  const p: PrepareAction | null = getPreparationWithin(state, rolled)
  if (!p || rolled.actorId !== getPerformerId(p) || !state.characters[p.actorId]) return null
  return rolled.roll.degree === 'critical' || rolled.roll.HOP >= 5 ? p.actorId : null
}

export function getPerfectPreparationAP(c: CampaignCharacter): number {
  return hasGrant(c, 'perfectPreparation') ? 1 : 0
}
