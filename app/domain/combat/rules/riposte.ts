import type { Action, CombatState, StrikeAction } from '../types'
import { isDefense } from './actionCatalog'
import { getAction, getReactionsTo } from './log'

// abilities.tex "Riposte": "After defending a melee attack that misses or
// grazes, the character can make an attack with a +2 bonus to hit
// immediately after, if in range. The attack costs 1 AP less than the normal
// attack if made with an object different from the one used for defense."

// The defense a strike that missed or grazed was met with, when the defender
// knows Riposte: what the riposte is opened by.
export function getRiposteOpening(state: CombatState, root: Action): Action | null {
  if (root.kind !== 'strike' || (root.roll?.degree !== 'miss' && root.roll?.degree !== 'graze') || !root.targetId) return null
  if (!state.characters[root.targetId]?.abilities.includes('riposte')) return null
  return getReactionsTo(state, root.id).find((r) => r.actorId === root.targetId && isDefense(r.kind)) ?? null
}

// The defense the strike ripostes from; null for a strike that is no
// riposte.
export function getRiposteDefense(state: CombatState, strike: StrikeAction): Action | null {
  const opener = strike.spawnedBy ? getAction(state, strike.spawnedBy) : null
  return opener && isDefense(opener.kind) ? opener : null
}

// The AP the riposte takes off the attack's price. An evade is made with no
// object, so whatever the riposte is made with is another (the table's
// ruling).
export function getRiposteDiscount(state: CombatState, strike: StrikeAction): number {
  const defense = getRiposteDefense(state, strike)
  if (!defense) return 0
  const used = defense.kind === 'block' || defense.kind === 'intercept' ? defense.weaponKey : null
  return used === strike.weaponKey ? 0 : 1
}
