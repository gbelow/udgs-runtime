import type { Action, Deliveries } from '../types'
import type { Delivery } from '../../types'
import { isAttackAction } from './actionCatalog'

// What an action delivered, per character: a strike's single effect to its
// target, everything an explosion or a cast produced to whoever it was
// produced for. Empty before the action has anything to say.
export function getDeliveries(root: Action): { id: string; delivery: Delivery }[] {
  if (root.kind === 'blast' || root.kind === 'cast' || root.kind === 'spellTest' || root.kind === 'fall') return flatten(root.facts ?? {})
  if (root.kind === 'grapple') return flatten(root.facts?.deliveries ?? {})
  if (!isAttackAction(root) || !root.targetId || !root.facts) return []
  return [{ id: root.targetId, delivery: root.facts }]
}

function flatten(deliveries: Deliveries): { id: string; delivery: Delivery }[] {
  return Object.entries(deliveries).flatMap(([id, ds]) => ds.map((delivery) => ({ id, delivery })))
}
