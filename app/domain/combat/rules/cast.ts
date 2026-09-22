import type { Delivery } from '../../types'
import type { ActionOf, CastAction, CombatState, StrikeAction } from '../types'
import { getSelfEffects, getTargetEffects, produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey } from '../../spells'

// combat.tex "Opportunity Attack": each threatener the cast drew gets one
// attack, spawned in turn (commands/action.ts `advanceCast`) as reactions
// resolve.
export function getCastOpportunityAttacks(state: CombatState, action: CastAction): { reaction: ActionOf<'opportunityAttack'>; strike: StrikeAction | null }[] {
  return state.actions
    .flatMap((r) => (r.reactionTo === action.id && r.kind === 'opportunityAttack' ? [r] : []))
    .map((reaction) => {
      const strike = state.actions.find((a) => a.spawnedBy === reaction.id)
      return { reaction, strike: strike?.kind === 'strike' ? strike : null }
    })
}

// spells.tex "Concentration": "Being interrupted causes the loss of
// concentration" — an opportunity attack the cast drew that lands with
// interruption cancels it, same as the caster giving the spell up to answer
// one actively (`cancelCast`): nothing it would have produced lands, though
// the AP and STA already spent stay spent.
export function isCastCancelled(state: CombatState, action: CastAction): boolean {
  return action.cancelled || getCastOpportunityAttacks(state, action).some(({ strike }) => strike?.status === 'resolved' && strike.interruption !== 'none')
}

// spells.tex "Casting spells": what the cast produces, per character — the
// caster's own effects to the caster, the target's to the target, nothing
// from a cast that failed or was cancelled. From here the caster is out of
// it: each delivery is the one who holds it's to roll. A charged spell
// produces nothing now: "activates an object that stays charged", and what
// it does waits in the object until the charge is released.
export function getCastFacts(state: CombatState, root: CastAction): Record<string, Delivery[]> {
  const caster = state.characters[root.actorId]
  if (!caster || root.roll?.degree !== 'hit' || !isSpellKey(root.key) || isCastCancelled(state, root)) return {}
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
