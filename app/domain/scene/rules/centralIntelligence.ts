import type { SceneState } from '../types'
import { isAbilityActive } from '../../character/rules/effects'
import { getCunning, getCunningTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getLinkedTargets } from './link'

const CENTRAL_INTELLIGENCE = 'central-intelligence'
const TELEPATHIC_LINK = 'telepathic-link'

// abilities.tex "Central Intelligence": "All characters connected by a
// telepathic link can choose to use the caster's cunning value instead of
// their own." Who lends the character their cunning: every caster holding
// it switched on and a telepathic link to them.
function getCunningLenders(state: SceneState, id: string): string[] {
  return Object.values(state.characters)
    .filter((c) => c.id !== id && isAbilityActive(c, CENTRAL_INTELLIGENCE) && getLinkedTargets(state, c.id, TELEPATHIC_LINK).includes(id))
    .map((c) => c.id)
}

// The cunning the character tests with in the fight: their own, or a
// lender's where that is higher, since nobody would choose the lower.
export function getFightCunningTerms(state: SceneState, id: string): Term[] {
  const c = state.characters[id]
  if (!c) return []
  const own = getCunningTerms(c)
  const lent = Math.max(-Infinity, ...getCunningLenders(state, id).map((lender) => getCunning(state.characters[lender])))
  return lent > sumTerms(own) ? [{ label: 'Central Intelligence', value: lent }] : own
}
