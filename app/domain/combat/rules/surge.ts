import type { CampaignCharacter } from '../../types'
import type { ActionKind, CombatState } from '../types'
import { SURGES, type SurgeAllowance } from '../../tables'
import { EarmarkedSurge, getBindingSurge } from '../../character/rules/surge'
import { ACTIONS, isReaction } from './actionCatalog'
import { isInGrapple } from './partners'
import { isInTurn } from './turn'

// combat.tex "Push and drag": moving with a grapple, which a surge counts as
// an action within a grapple, not as movement (the table's ruling)
const GRAPPLE_MOVEMENT: readonly ActionKind[] = ['drag', 'assist', 'carry']

// The actions each allowance in SURGES names. "grapple" is not a list: it
// is every action, for one in a grapple.
const ALLOWANCE_KINDS: Record<Exclude<SurgeAllowance, 'grapple'>, readonly ActionKind[]> = {
  movement: ['move', 'follow'],
  reactions: (Object.keys(ACTIONS) as ActionKind[]).filter(isReaction).filter((kind) => !GRAPPLE_MOVEMENT.includes(kind)),
  attacks: ['strike', 'opportunityAttack', 'counterattack'],
  defenses: ['evade', 'evasiveJump', 'block', 'intercept', 'brace'],
  reflexes: ['evasion', 'guard', 'avoidExplosion'],
}

// Whether the surge's AP may pay for the kind, for the character where they
// stand.
function allows(state: CombatState, c: CampaignCharacter, surge: EarmarkedSurge, kind: ActionKind): boolean {
  return (SURGES[surge].allows as readonly SurgeAllowance[]).some((a) => (a === 'grapple' ? isInGrapple(state, c.id) : ALLOWANCE_KINDS[a].includes(kind)))
}

// Why the kind cannot be declared while a surge's AP is left, or null.
export function getSurgeBarFor(state: CombatState, c: CampaignCharacter, kind: ActionKind): string | null {
  const surge = getBindingSurge(c)
  return !surge || allows(state, c, surge, kind) ? null : `${surge} surge AP left`
}

// combat.tex "Flee": "The flee action can only use actions allowed by
// movement surge" — in a flee turn, only those, and only out of the surge's
// AP: once it is spent, the flee is over but for ending the turn.
export function getFleeBarFor(state: CombatState, c: CampaignCharacter, kind: ActionKind): string | null {
  if (!state.fleeing || !isInTurn(state, c.id)) return null
  if (!allows(state, c, 'movement', kind)) return 'fleeing'
  return c.resources.surgeAP > 0 ? null : 'flee surge spent'
}
