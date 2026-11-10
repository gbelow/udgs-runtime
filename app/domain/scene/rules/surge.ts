import type { CampaignCharacter, SurgeKind } from '../../types'
import type { Action, ActionKind, SceneState } from '../types'
import { SURGES, type SurgeAllowance } from '../../tables'
import { surgeKinds } from '../../lists'
import { EarmarkedSurge, canSurge, getBindingSurge, getSurgeAPLeft, getSurged } from '../../character/rules/surge'
import { ACTIONS, isReaction } from './actionCatalog'
import { getSurgeAllows } from '../../character/rules/effects'
import { isInGrapple } from './partners'
import { getSurgeTurnBar, isInTurn } from './turn'

// combat.tex "Push and drag": moving with a grapple, which a surge counts as
// an action within a grapple, not as movement (the table's ruling)
const GRAPPLE_MOVEMENT: readonly ActionKind[] = ['drag', 'assist', 'carry']

// spells.tex "Sustained Spells": a held spell is let go of for nothing, so no
// surge's AP stands in its way
const FREE_KINDS: readonly ActionKind[] = ['releaseSpell']

// The actions each allowance in SURGES names. "grapple" is not a list: it
// is every action, for one in a grapple.
const ALLOWANCE_KINDS: Record<Exclude<SurgeAllowance, 'grapple' | 'escape'>, readonly ActionKind[]> = {
  movement: ['move', 'follow'],
  reactions: (Object.keys(ACTIONS) as ActionKind[]).filter(isReaction).filter((kind) => !GRAPPLE_MOVEMENT.includes(kind)),
  attacks: ['strike', 'opportunityAttack', 'counterattack'],
  defenses: ['evade', 'evasiveJump', 'block', 'intercept', 'brace'],
  reflexes: ['evasion', 'guard', 'avoidExplosion', 'blockExplosion'],
}

function inAllowance(state: SceneState, c: CampaignCharacter, a: SurgeAllowance, kind: ActionKind, maneuver?: string): boolean {
  if (a === 'grapple') return isInGrapple(state, c.id)
  if (a === 'escape') return kind === 'grapple' && maneuver === 'escape' && isInGrapple(state, c.id)
  return ALLOWANCE_KINDS[a].includes(kind)
}

// The learned allowances of the surge that take in the kind (abilities.tex
// "Charge": "Learns to perform one attack with the APs from a movement
// surge").
function getLearnedAllows(state: SceneState, c: CampaignCharacter, surge: EarmarkedSurge, kind: ActionKind, maneuver?: string) {
  return getSurgeAllows(c).filter((a) => a.surge === surge && inAllowance(state, c, a.allows, kind, maneuver))
}

function allowedByRule(state: SceneState, c: CampaignCharacter, surge: EarmarkedSurge, kind: ActionKind, maneuver?: string): boolean {
  return (SURGES[surge].allows as readonly SurgeAllowance[]).some((a) => inAllowance(state, c, a, kind, maneuver))
}

// Whether the surge's AP may pay for the kind, for the character where they
// stand: by the surge itself or by what they have learned.
function allows(state: SceneState, c: CampaignCharacter, surge: EarmarkedSurge, kind: ActionKind, maneuver?: string): boolean {
  return allowedByRule(state, c, surge, kind, maneuver) || getLearnedAllows(state, c, surge, kind, maneuver).length > 0
}

// Whether the action, paid while a surge's AP is left, is one only a learned
// allowance lets it pay for, and that allowance ends the surge with it
// (abilities.tex "Charge": "loses the rest of the AP from the surge").
export function endsSurge(state: SceneState, action: Action): boolean {
  const c = state.characters[action.actorId]
  const surge = c ? getBindingSurge(c) : null
  if (!c || !surge) return false
  const maneuver = action.kind === 'grapple' ? action.maneuver : undefined
  return !allowedByRule(state, c, surge, action.kind, maneuver) && getLearnedAllows(state, c, surge, action.kind, maneuver).some((a) => a.endsSurge)
}

// Why the kind cannot be declared while a surge's AP is left, or null.
export function getSurgeBarFor(state: SceneState, c: CampaignCharacter, kind: ActionKind, maneuver?: string): string | null {
  const surge = getBindingSurge(c)
  return !surge || FREE_KINDS.includes(kind) || allows(state, c, surge, kind, maneuver) ? null : `${surge} surge AP left`
}

// combat.tex "Flee": "The flee action can only use actions allowed by
// movement surge" — in a flee turn, only those, and only out of the surge's
// AP: once it is spent, the flee is over but for ending the turn.
export function getFleeBarFor(state: SceneState, c: CampaignCharacter, kind: ActionKind, maneuver?: string): string | null {
  if (!state.fleeing || !isInTurn(state, c.id) || FREE_KINDS.includes(kind)) return null
  if (!allows(state, c, 'movement', kind, maneuver)) return 'fleeing'
  return getSurgeAPLeft(c) > 0 ? null : 'flee surge spent'
}

// combat.tex "Action surge": each surge the character may make now, with the
// fight as it would leave them — what an action closed to them now is
// weighed against, to say whether a surge would open it.
export function getSurgeProbes(state: SceneState, c: CampaignCharacter): { kind: SurgeKind; state: SceneState }[] {
  return surgeKinds.flatMap((kind) => {
    if (!canSurge(kind)(c) || getSurgeTurnBar(state, c.id, kind)) return []
    return [{ kind, state: { ...state, characters: { ...state.characters, [c.id]: getSurged(kind)(c) } } }]
  })
}
