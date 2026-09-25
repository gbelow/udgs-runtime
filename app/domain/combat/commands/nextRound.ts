import type { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { cure, inflict } from '../../character/commands/addAffliction'
import { isDead } from '../../character/rules/afflictions'
import type { CombatState } from '../types'
import { getPlacedFootprint } from '../rules/board'
import { coordKey } from '../geometry'

// combat.tex "Gas": "anyone that starts the round inside a suffocating gas
// is suffocating by default" — and out of it, no longer for that reason.
// Nothing on a fight with no board, or for anyone not placed on it.
function breathe(state: CombatState, c: CampaignCharacter): CampaignCharacter {
  const footprint = getPlacedFootprint(state, c.id)
  if (!state.board || !footprint) return c
  const inGas = footprint.some((cell) => state.board?.terrain[coordKey(cell)]?.suffocating)
  return inGas ? inflict(['suffocating'])(c) : cure(['suffocating'])(c)
}

// combat.tex "End of the round": "reset to 8 AP minus any negative AP they
// had. Any unspent AP is lost."
function resetAP(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, AP: Math.min(8, c.resources.AP + 8) } }
}

// Everything due at the round change lands on each character — the upkeep of
// what is held on or was fired this round, and not being able to breathe; a
// fired ability is then spent, the bleed runs on (combat.tex "Bleed": +1 IL
// per bleed intensity at the end of every round in combat), the surge used
// this round is cleared and the AP reset. A dead character has nothing left
// to pay or bleed out further.
function endRound(state: CombatState, c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const due = bleed(1)(suffocate(expireUsedAbilities(applyTrigger('end_round')(breathe(state, c)))))
  return resetAP({ ...due, usedSurge: null })
}

export function nextRound(state: CombatState): CombatState {
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, endRound(state, c)]))
  return { ...state, characters, round: state.round + 1 }
}
