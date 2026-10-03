import type { CampaignCharacter } from '../../types'
import { canSurgeAtAll } from '../../character/rules/surge'
import { getCunningTerms } from '../../character/rules/skills'
import type { Term } from '../../character/rules/terms'
import type { CombatState, FeintAction } from '../types'
import { getDistanceBetween, getMeleeRange } from './board'
import { isWon } from './test'

// "A cunning against cunning test between two characters in melee": whoever
// either can strike from where they stand, and a cell is the least. On a
// fight without a board every character is in melee.
function isInMelee(state: CombatState, a: string, b: string): boolean {
  const distance = getDistanceBetween(state, a, b)
  const [ca, cb] = [state.characters[a], state.characters[b]]
  return distance === null || !ca || !cb || distance <= Math.max(1, getMeleeRange(ca), getMeleeRange(cb))
}

export function getFeintTargets(state: CombatState, actorId: string): string[] {
  const actor = state.characters[actorId]
  if (!actor || !canSurgeAtAll(actor)) return []
  return Object.keys(state.characters).filter((id) => id !== actorId && canSurgeAtAll(state.characters[id]) && isInMelee(state, actorId, id))
}

// Why the character cannot feint anyone now, or null.
export function getFeintBar(state: CombatState, c: CampaignCharacter): string | null {
  if (c.usedSurge !== null) return 'action surge used'
  if (!canSurgeAtAll(c)) return 'no surge to pay for'
  return getFeintTargets(state, c.id).length > 0 ? null : 'nobody in melee to feint'
}

// The actor's cunning against the target's.
export function getFeintTerms(state: CombatState, root: FeintAction): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return actor && target ? { skill: getCunningTerms(actor), DL: getCunningTerms(target) } : null
}

// "On a hit or crit, the target is forced to take their turn and use one
// action surge ... On a miss or graze, the effect is reversed."
export function getFeinted(root: FeintAction): string | null {
  return isWon(root) ? root.targetId : root.actorId
}
