import { ROUND_AP } from '../../tables'
import type { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { burnAtRoundStart, burnScorch } from '../../character/commands/deliver'
import { isDead } from '../../character/rules/afflictions'
import type { CombatState } from '../types'
import { getHazardOf } from '../rules/hazard'
import { settleHazards } from './hazard'

// combat.tex "End of the round": "reset to 8 AP minus any negative AP they
// had. Any unspent AP is lost." — a surge's among it.
function resetAP(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, AP: Math.min(ROUND_AP, c.resources.AP + ROUND_AP), surgeAP: 0 } }
}

// Everything due at the round change lands on each character — the upkeep of
// what is held on or was fired this round; the fire touched in a turn the
// round change ended burns, and then the counter burns with the fire they
// stand in added, as one instance (combat.tex "Burning", "Fire"); not being able to
// breathe costs its STA. A fired ability is then spent, the bleed runs on
// (combat.tex "Bleed": +1 IL per bleed intensity at the end of every round in
// combat), the surge used this round is cleared and the AP reset. A dead
// character has nothing left to pay or bleed out further.
function endRound(state: CombatState, c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const burnt = burnAtRoundStart(getHazardOf(state, c.id).fire)(burnScorch(applyTrigger('end_round')(c)))
  const due = bleed(1)(suffocate(expireUsedAbilities(burnt)))
  return resetAP({ ...due, usedSurge: null })
}

// combat.tex "Environmental and ongoing effects": "applied at the beginning
// of the round", to whoever stands in them as the ground is now.
export function nextRound(state: CombatState): CombatState {
  const settled = settleHazards(state)
  const characters = Object.fromEntries(Object.entries(settled.characters).map(([id, c]) => [id, endRound(settled, c)]))
  return { ...settled, characters, round: state.round + 1, inTurnCharacter: '', fleeing: false, turnQueue: [], fleers: [], contenders: [], lastContest: null }
}
