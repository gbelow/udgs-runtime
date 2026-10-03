import type { CombatState, Result, RootAction } from '../types'
import type { Delivery } from '../../types'
import { getDeliveries } from '../rules/deliveries'
import { deliver } from '../../character/commands/deliver'
import { explainOutcome, getOutcome } from '../../character/rules/damage'

// What the landed action's damage comes to on each it reaches, and why: read
// off each target as they stand before it lands, one delivery after another
// as they are applied, so what is written is what the target takes.
export function getResults(state: CombatState, settled: RootAction): Result[] {
  const byTarget = new Map<string, Delivery[]>()
  for (const { id, delivery } of getDeliveries(settled)) byTarget.set(id, [...(byTarget.get(id) ?? []), delivery])
  return [...byTarget].flatMap(([targetId, deliveries]) => {
    let target = state.characters[targetId]
    if (!target) return []
    const results: Result[] = []
    for (const delivery of deliveries) {
      const { effect, degree } = delivery
      if (effect.type === 'damage' && degree !== null) {
        results.push({ targetId, outcome: getOutcome(effect.effect, degree, target), steps: explainOutcome(effect.effect, degree, target) })
      }
      target = deliver(delivery)(target)
    }
    return results
  })
}
