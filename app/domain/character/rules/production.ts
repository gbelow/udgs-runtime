import { DamageSchema, type Area, type Character, type DamageComponent, type Delivery, type Effect, type Spell, type SpellEffect } from '../../types'
import type { SpellModification } from '../../tables'
import { getDM, getRM } from './helpers'
import { getForce } from './skills'
import { resolveDL } from './spells'

// spells.tex "Casting spells": what a spell produces once it is cast — its
// effects as this caster makes them, every number resolved, each on its way
// to whoever it is aimed at. The caster's part ends here: a delivery with a
// test is the target's to roll.

export type Improvements = Partial<Record<SpellModification, number>>

// creating.tex "Reach Multiplier": "xRM" — an area at the producer's size.
function scaleArea(area: Area, RM: number): Area {
  return area.shape === 'explosion'
    ? { shape: 'explosion', radius: Math.floor(area.radius * RM) }
    : { shape: 'spray', length: Math.floor(area.length * RM), angle: area.angle }
}

// spells.tex "Relationship between Size and Sorcery": "Any spell that has
// DM, SM, RM or VM marked in it is scaled to character size" — the effects
// as this caster makes them, with every number their size decides already
// worked out and nothing left for anyone else to scale. What a charge
// carries into an object (spells.tex "Charged"), since whoever releases it
// is not who made it, and what a payload covers when it goes off.
export function produceEffects(c: Character, effects: SpellEffect[], improved: Improvements = {}): SpellEffect[] {
  const RM = getRM(c)
  return effects.map((e): SpellEffect => ({
    ...e,
    ...(e.type === 'damage' ? { effect: scaleDamage(c, e.effect.damage, e.scaled, improved) } : {}),
    area: e.area ? scaleArea(e.area, RM) : null,
    scaled: false,
  }) as SpellEffect)
}

// "xDM": scaled by the caster's size; spells.tex "Amplify": "multiply an
// effect marked DM ... once more", per purchase.
function scaleDamage(c: Character, damage: DamageComponent[], scaled: boolean, improved: Improvements): { damage: DamageComponent[] } {
  const scale = scaled ? Math.pow(getDM(c), 1 + (improved.amplify ?? 0)) : 1
  return { damage: damage.map((d) => ({ ...d, value: Math.floor(d.value * scale) })) }
}

// The effect stripped of its reach: what is delivered.
function bare(c: Character, effect: SpellEffect, improved: Improvements): Effect {
  const { name, trigger, type } = effect
  switch (type) {
    case 'damage': {
      // combat.tex "Intercept": force is compared against whoever met the
      // blow, which only means something for a single target — an area
      // effect's blast carries its own authored force, not the producer's.
      return { name, trigger, type, effect: DamageSchema.parse({
        ...effect.effect,
        ...scaleDamage(c, effect.effect.damage, effect.scaled, improved),
        force: effect.target === 'area' ? effect.effect.force : getForce(c),
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
