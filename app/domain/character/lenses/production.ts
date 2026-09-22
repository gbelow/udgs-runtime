import { DamageSchema, type Character, type Delivery, type Effect, type Spell, type SpellEffect } from '../../types'
import type { SpellModification } from '../../tables'
import { getDM } from './helpers'
import { getForce } from './skills'
import { resolveDL } from './spells'

// spells.tex "Casting spells": what a spell produces once it is cast — its
// effects as this caster makes them, every number resolved, each on its way
// to whoever it is aimed at. The caster's part ends here: a delivery with a
// test is the target's to roll.

export type Improvements = Partial<Record<SpellModification, number>>

// The effect stripped of its reach: what is delivered.
function bare(c: Character, effect: SpellEffect, improved: Improvements): Effect {
  const { name, trigger, type } = effect
  switch (type) {
    case 'damage': {
      // "xDM": scaled by the caster's size; spells.tex "Amplify": "multiply
      // an effect marked DM ... once more", per purchase
      const scale = effect.scaled ? Math.pow(getDM(c), 1 + (improved.amplify ?? 0)) : 1
      return { name, trigger, type, effect: DamageSchema.parse({
        ...effect.effect,
        damage: effect.effect.damage.map((d) => ({ ...d, value: Math.floor(d.value * scale) })),
        force: getForce(c),
      }) }
    }
    case 'affliction': return { name, trigger, type, effect: effect.effect }
    case 'terrain': return { name, trigger, type, effect: effect.effect }
    case 'cost': return { name, trigger, type, effect: effect.effect }
    case 'buff': return { name, trigger, type, effect: effect.effect }
    case 'suppression': return { name, trigger, type, effect: effect.effect }
  }
}

// `locks` names the spell a locked effect is carried under (spells.tex
// "Curse"), so the target can read it off the catalog and beat it.
export function produceSpellEffect(c: Character, effect: SpellEffect, improved: Improvements = {}, key: string | null = null): Delivery {
  const test = effect.resist ? { roll: effect.resist.roll, DL: resolveDL(c, effect.resist.dl, effect.resist.roll).value ?? 0 } : null
  return { effect: bare(c, effect, improved), degree: test ? null : 'hit', test, when: null, then: [], locks: effect.duration === 'locked' ? key : null }
}

// spells.tex "Extend Spell": "casting range +100%, then +200%, +300%" — the
// metres an effect reaches at the improvements bought; null is touch or
// self.
export function getEffectRange(effect: SpellEffect, improved: Improvements): number | null {
  return effect.range === null ? null : effect.range * (1 + (improved.extend ?? 0))
}

export function getSelfEffects(spell: Spell): SpellEffect[] {
  return spell.effects.filter((e) => e.target === 'self')
}

export function getTargetEffects(spell: Spell): SpellEffect[] {
  return spell.effects.filter((e) => e.target === 'target')
}
