import type { CampaignCharacter } from '../../types'
import type { ActionKind } from '../types'
import { EarmarkedSurge, getBindingSurge } from '../../character/rules/surge'

// combat.tex "Action surge": what an earmarked surge's AP may be spent on, as
// the table rules it. The movement surge: movement, which in a grapple is a
// push or a drag (combat.tex "Grappled"). The combat surge: every melee
// strike, defense, reflex and grapple action, and movement — though a run
// only starts on movement-surge AP (`canStartRun`).
const ALLOWED: Record<EarmarkedSurge, readonly ActionKind[]> = {
  movement: ['move', 'follow', 'drag', 'carry', 'assist'],
  combat: [
    'strike', 'opportunityAttack', 'counterattack',
    'evade', 'evasiveJump', 'block', 'intercept', 'brace',
    'evasion', 'guard', 'avoidExplosion',
    'grapple', 'drag', 'release', 'holdBack', 'resist', 'assist', 'carry', 'letGo',
    'move', 'follow',
  ],
}

// Why the kind cannot be declared while a surge's AP is left, or null.
export function getSurgeBarFor(c: CampaignCharacter, kind: ActionKind): string | null {
  const surge = getBindingSurge(c)
  return !surge || ALLOWED[surge].includes(kind) ? null : `${surge} surge AP left`
}
