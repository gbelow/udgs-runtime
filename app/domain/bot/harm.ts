import type { SceneState } from '../scene/types'
import type { CampaignCharacter, Outcome } from '../types'
import { getInjuryCapacity, isDead } from '../character/rules/afflictions'
import { getLanded } from '../scene/rules/log'

// What a blow costs a character in the fight, as a share of the character
// (the user's weight, 2026-11-12): twice the injury levels it adds and three
// times the bleeding, over a hundred, up to the whole of it. A character
// already out of the fight (combat.tex "Injuries and Death": dead, or past its
// injury capacity and collapsed) has nothing more to lose.

const PER_IL = 2
const PER_BLEED = 3
const WHOLE = 100

export function getWoundHarm(outcome: Outcome): number {
  return Math.min(1, (PER_IL * outcome.IL + PER_BLEED * outcome.bleed) / WHOLE)
}

// combat.tex "Injuries and Death": dead, or collapsed at its injury capacity.
export function isOutOfFight(c: CampaignCharacter | undefined): boolean {
  return !c || isDead(c) || c.injuries.injuryLevel >= getInjuryCapacity(c)
}

// What the blow's outcome costs the target as it stands before it.
export function getOutcomeHarm(target: CampaignCharacter, outcome: Outcome | null): number {
  if (!outcome || isOutOfFight(target)) return 0
  return getWoundHarm(outcome)
}

// What the character lost in the fight between two states of it: the harm of
// each blow that landed on it in between, up to the whole of it.
export function getHarmTaken(before: SceneState, after: SceneState, id: string): number {
  if (isOutOfFight(before.characters[id])) return 0
  const blows = getLanded(after).slice(getLanded(before).length).flatMap((a) => a.results ?? []).filter((r) => r.targetId === id)
  return Math.min(1, blows.reduce((sum, r) => sum + getWoundHarm(r.outcome), 0))
}
