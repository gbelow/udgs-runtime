import type { SceneState } from '../scene/types'
import type { CampaignCharacter, Outcome } from '../types'
import { getInjuryCapacity, isDead } from '../character/rules/afflictions'
import { getLanded } from '../scene/rules/log'

// What a blow costs a character in the fight, as a share of the character:
// by the tier of the wound it takes (the user's scale, 2026-11-12: a T4 is near
// the end of a fight at any injury level, 0.6, and each tier below costs 0.15
// less, down to nothing at T0; the tiers above go on in the same steps), and
// the whole character when the blow takes it out of the fight (combat.tex
// "Injuries and Death": dead, or past its injury capacity and collapsed).

const T4_HARM = 0.6
const PER_TIER = 0.15

export function getTierHarm(tier: number | null): number {
  return tier === null || tier <= 0 ? 0 : Math.min(1, T4_HARM + PER_TIER * (tier - 4))
}

// combat.tex "Injuries and Death": dead, or collapsed at its injury capacity.
export function isOutOfFight(c: CampaignCharacter | undefined): boolean {
  return !c || isDead(c) || c.injuries.injuryLevel >= getInjuryCapacity(c)
}

// What the blow's outcome costs the target as it stands before it.
export function getOutcomeHarm(target: CampaignCharacter, outcome: Outcome | null): number {
  if (!outcome) return 0
  if (outcome.dead || target.injuries.injuryLevel + outcome.IL >= getInjuryCapacity(target)) return 1
  return getTierHarm(outcome.tier)
}

// What the character lost in the fight between two states of it: the whole of
// it if it went out of the fight, else the harm of each blow that landed on it
// in between, up to the whole of it.
export function getHarmTaken(before: SceneState, after: SceneState, id: string): number {
  if (isOutOfFight(before.characters[id])) return 0
  if (isOutOfFight(after.characters[id])) return 1
  const blows = getLanded(after).slice(getLanded(before).length).flatMap((a) => a.results ?? []).filter((r) => r.targetId === id)
  return Math.min(1, blows.reduce((sum, r) => sum + getTierHarm(r.outcome.tier), 0))
}
