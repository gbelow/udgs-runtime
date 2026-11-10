import type { Action, SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { PROTECTION_FAILED_TIER, PROTECTION_RANGE } from '../../tables'
import { hasGrant } from '../../character/rules/effects'
import { getDistanceBetween } from './board/board'
import { getPressureKey } from './morale'
import { getRecipeEntry } from './recipes'

// abilities.tex "Guardian": the protection surge and what its abilities do
// with it. The surge itself is SURGES.protection (tables.ts); the run it buys
// is the combined move its ability's recipe carries (rules/combinedMove.ts),
// opened while `isProtectionGuard` holds.

// abilities.tex "Protection Surge": "When they realize that an ally within
// 10m has been attacked, they can make a protection surge. This is a reaction
// surge that allows repositioning immediately to assist the ally." The move
// is open to one holding the surge (made for it, `getSurgeProbes`), against a
// strike or a shot aimed at someone of their own party within 10 m of them,
// once a round: "Guardian's Vigor" II, "can reposition themselves a second
// time during the round". Realizing it is noticing the attack, as every
// reaction asks (rules/stealth.ts).
export function isProtectionGuard(state: SceneState, id: string, root: Action | null): boolean {
  const c = state.characters[id]
  if (!c || c.usedSurge !== 'protection' || getRepositions(state, id) >= getRepositionsAllowed(c)) return false
  if ((root?.kind !== 'strike' && root?.kind !== 'shoot') || !root.targetId || root.targetId === id || !isAlly(state, id, root.targetId)) return false
  const apart = getDistanceBetween(state, id, root.targetId)
  return apart === null || apart <= PROTECTION_RANGE
}

// Whoever is in the character's party: those a rally reaches (combat.tex
// "Rally": "allies").
export function isAlly(state: SceneState, id: string, other: string): boolean {
  return getPressureKey(state, id) === getPressureKey(state, other)
}

function getRepositionsAllowed(c: CampaignCharacter): number {
  return hasGrant(c, 'repositionTwice') ? 2 : 1
}

// How many times the character has repositioned under their protection surge
// this round.
export function getRepositions(state: SceneState, id: string): number {
  return state.protectionMoves.filter((m) => m === id).length
}

// Whether the defense is one made with the run of a protection surge.
export function isProtectionMove(state: SceneState, action: Action): boolean {
  const c = state.characters[action.actorId]
  const entry = c ? getRecipeEntry(c, action.recipe ?? null) : null
  return entry?.recipe.type === 'combinedMove' && entry.recipe.openWhen === 'protectionSurge'
}

// "Guardian": "Loses 1 XP whenever they refuse to use their protection surge
// and an ally takes tier 2 damage or higher": the landed attack's results on
// its target.
export function isProtectionFailed(action: Action): boolean {
  return action.results.some((r) => r.targetId === action.targetId && (r.outcome.tier ?? 0) >= PROTECTION_FAILED_TIER)
}
