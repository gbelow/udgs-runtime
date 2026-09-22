import type { Action, CombatState } from '../types'
import type { Outcome } from '../../character/rules/damage'
import { getAttackFacts, outcomeOf } from '../rules/damage'
import { getExplosionFacts } from '../rules/explosion'

// The outcome of the open action on everyone it lands on, as it would land
// now: the same function the resolution applies, so the preview and the
// result cannot differ. One entry for the target of a strike or a shot; one
// per character in an explosion's area.
export function getOutcomePreviews(state: CombatState, root: Action): { id: string; outcome: Outcome }[] {
  if (root.kind === 'explosion') {
    const facts = root.facts ?? getExplosionFacts(state, root)
    return Object.entries(facts).flatMap(([id, deliveries]) => {
      const target = state.characters[id]
      return deliveries.flatMap((d) => {
        const outcome = target ? outcomeOf(d, target) : null
        return outcome ? [{ id, outcome }] : []
      })
    })
  }
  if ((root.kind !== 'strike' && root.kind !== 'shoot') || !root.targetId) return []
  const target = state.characters[root.targetId]
  const facts = root.facts ?? getAttackFacts(state, root)
  const outcome = target && facts ? outcomeOf(facts, target) : null
  return outcome ? [{ id: root.targetId, outcome }] : []
}
