import type { AfflictionKey, CampaignCharacter } from '../../types'
import type { SceneState } from '../types'
import { hasAffliction } from '../../character/rules/afflictions'
import { getHazardOf } from './hazard'
import { getGrappleAfflictionsOf } from './grapple'
import { isVisorClosed } from '../../character/rules/armor'
import { hasGrant } from '../../character/rules/abilities'
import { getClimbDegree, isTrivialClimb } from './cliff'
import { findOpenRoot } from './log'
import { clampDepth, getWaterOf } from './swim'

// What the fight puts on the character on top of what they carry, read off
// the fight rather than stored on them: suffocation while their footprint is
// inside a suffocating gas (combat.tex "Gas": "anyone that is inside a
// suffocating gas is suffocating by default"), and what their grapples put
// on them, and below the surface of the water (combat.tex "Swimming": a
// swimmer breathes when "height is level with the surface"), and prone while
// climbing. Nothing outside a fight.
export function getSituationalAfflictions(state: SceneState | null, id: string): AfflictionKey[] {
  if (!state) return []
  const c = state.characters[id]
  const water = getWaterOf(state, id)
  // gear.tex "Closed helmet": "makes swimming always suffocating"
  const helmeted = water !== null && !!c && isVisorClosed(c)
  const submerged = clampDepth(water, state.board?.placements[id]?.depth ?? 0) > 0
  const cannotBreathe = getHazardOf(state, id).suffocating || submerged || helmeted
  return [...(cannotBreathe ? ['suffocating' as const] : []), ...(isClimbing(state, id) ? ['prone' as const] : []), ...getGrappleAfflictionsOf(state, id)]
}

// combat.tex "Climbing": "A character who is climbing is considered prone" —
// while the climb is under way (the opportunity attacks along it are being
// fought), and not for one with abilities.tex "Climber III" whose test was a
// critical.
function isClimbing(state: SceneState, id: string): boolean {
  const hanging = state.board?.placements[id]?.climb
  if (hanging) return !hanging.upright
  const climb = findOpenRoot(state, 'move', (m) => m.actorId === id && m.movement === 'climb' && m.step === 'post')
  const c = state.characters[id]
  return !!climb && !!c && !isTrivialClimb(state, climb) && !(hasGrant(c, 'climbUpright') && getClimbDegree(state, climb) === 'critical')
}

// Whether the character has the affliction, by the sheet or by the fight.
export function hasFightAffliction(state: SceneState, c: CampaignCharacter, key: AfflictionKey): boolean {
  return hasAffliction(c, key, getSituationalAfflictions(state, c.id))
}

// combat.tex "Suffocation": cannot breathe, so "cannot Rest".
export function isSuffocating(state: SceneState, c: CampaignCharacter): boolean {
  return hasFightAffliction(state, c, 'suffocating')
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
export function isImmobile(state: SceneState, c: CampaignCharacter): boolean {
  return hasFightAffliction(state, c, 'immobile')
}
