import type { Delivery } from '../../types'
import type { CastAction, CombatState } from '../types'
import { isCancelled } from './opportunity'
import { getSelfEffects, getTargetEffects, produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey } from '../../spells'

// spells.tex "Casting spells": what the cast produces, per character — the
// caster's own effects to the caster, the target's to the target, nothing
// from a cast that failed or was cancelled. From here the caster is out of
// it: each delivery is the one who holds it's to roll. A charged spell
// produces nothing now: "activates an object that stays charged", and what
// it does waits in the object until the charge is released.
export function getCastFacts(state: CombatState, root: CastAction): Record<string, Delivery[]> {
  const caster = state.characters[root.actorId]
  if (!caster || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCancelled(state, root)) return {}
  const spell = SPELLS[root.key]
  if (spell.type === 'charged') return {}
  const facts: Record<string, Delivery[]> = {}
  const own = getSelfEffects(spell).filter((e) => e.trigger === 'instant').map((e) => produceSpellEffect(caster, e, root.improved, root.key))
  if (own.length > 0) facts[root.actorId] = own
  if (root.targetId && state.characters[root.targetId]) {
    const theirs = getTargetEffects(spell).map((e) => produceSpellEffect(caster, e, root.improved, root.key))
    if (theirs.length > 0) facts[root.targetId] = [...(facts[root.targetId] ?? []), ...theirs]
  }
  return facts
}
