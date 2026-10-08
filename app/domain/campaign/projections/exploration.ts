import { EXPLORATION_ACTIONS } from '../../lists'
import type { CampaignState, ETPlan, ExhaustionRoll } from '../types'
import { canRestHeal, getExhaustionTest, getExplorationBar, getRestHealing, getRestRecovery, getWear } from '../rules/exploration'

// What a plan would do to the character over the ET, as changes to IL and
// exhaustion; `idle` is set on a rest that has no healing left today.
export type PlanOption = { plan: ETPlan | null; IL: number; exhaustion: number; idle: boolean }

export type ExplorationPanel = {
  bar: string | null
  plan: ETPlan | null
  options: PlanOption[]
  // the DL of the Will test the ET will open with, if exhaustion calls for one
  willDL: number | null
  lastRoll: ExhaustionRoll | null
  potion: number
}

// survival.tex "Exhaustion", "Rest", "Wear" — what each plan for the coming
// ET would do to the character on the party's ground, and why none can be
// made.
export function getExplorationPanel(state: CampaignState, id: string): ExplorationPanel {
  const c = state.characters[id]
  if (!c) return { bar: 'no such character', plan: null, options: [], willDL: null, lastRoll: null, potion: 0 }
  const idle: PlanOption = { plan: null, IL: 0, exhaustion: 1, idle: true }
  const healing = getRestHealing(c, state.exposure)
  const rest: PlanOption = canRestHeal(state, id)
    ? { plan: 'rest', IL: healing < 0 ? -healing : -Math.min(healing, c.injuries.injuryLevel), exhaustion: -Math.min(getRestRecovery(state.exposure), c.resources.exhaustion), idle: false }
    : { ...idle, plan: 'rest' }
  return {
    bar: getExplorationBar(state, id),
    plan: state.plans[id] ?? null,
    options: [...EXPLORATION_ACTIONS.map((action): PlanOption => ({ plan: action, IL: getWear(c, action), exhaustion: 1, idle: false })), rest, idle],
    willDL: getExhaustionTest(c)?.DL ?? null,
    lastRoll: state.exhaustionRolls[id] ?? null,
    potion: c.injuries.potion,
  }
}
