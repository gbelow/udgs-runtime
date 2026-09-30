import type { AfflictionKey, CampaignCharacter } from '../../types'
import type { CombatState } from '../types'
import { hasAffliction } from '../../character/rules/afflictions'
import { getHazardOf } from './hazard'
import { getGrappleAfflictionsOf } from './grapple'

// What the fight puts on the character on top of what they carry, read off
// the fight rather than stored on them: suffocation while their footprint is
// inside a suffocating gas (combat.tex "Gas": "anyone that is inside a
// suffocating gas is suffocating by default"), and what their grapples put
// on them. Nothing outside a fight.
export function getSituationalAfflictions(state: CombatState | null, id: string): AfflictionKey[] {
  if (!state) return []
  return [...(getHazardOf(state, id).suffocating ? ['suffocating' as const] : []), ...getGrappleAfflictionsOf(state, id)]
}

// Whether the character has the affliction, by the sheet or by the fight.
export function hasFightAffliction(state: CombatState, c: CampaignCharacter, key: AfflictionKey): boolean {
  return hasAffliction(c, key, getSituationalAfflictions(state, c.id))
}

// combat.tex "Suffocation": cannot breathe, so "cannot Rest".
export function isSuffocating(state: CombatState, c: CampaignCharacter): boolean {
  return hasFightAffliction(state, c, 'suffocating')
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
export function isImmobile(state: CombatState, c: CampaignCharacter): boolean {
  return hasFightAffliction(state, c, 'immobile')
}
