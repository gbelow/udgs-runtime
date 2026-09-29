import { DamageSchema, type Area, type Character, type DamageComponent, type Degree, type Delivery, type Effect, type OutcomeEffect, type Spell, type SpellEffect } from '../../types'
import type { SpellModification } from '../../tables'
import { getDMAt, getRMAt } from './helpers'
import { getSize } from './misc'
import { getForce } from './skills'
import { resolveDL } from './spells'

// spells.tex "Casting spells": what a spell produces once it is cast — its
// effects as this caster makes them, every number resolved, each on its way
// to whoever it is aimed at. The caster's part ends here: a delivery with a
// test is the target's to roll.

export type Improvements = Partial<Record<SpellModification, number>>

// creating.tex "Reach Multiplier": "xRM" — an area at the spell's size.
function scaleArea(area: Area, RM: number): Area {
  return area.shape === 'explosion'
    ? { shape: 'explosion', radius: Math.floor(area.radius * RM) }
    : { shape: 'spray', length: Math.floor(area.length * RM), angle: area.angle }
}

// spells.tex "Relationship between Size and Sorcery": "Any spell that has
// DM, SM, RM or VM marked in it is scaled to character size", and "Amplify
// Spell" moves it up a size at a time — the effects at the size they are
// cast at (`getCastSize`), with every marked number worked out and nothing
// left for anyone else to scale. What a charge carries into an object
// (spells.tex "Charged"), since whoever releases it is not who made it,
// and what a payload covers when it goes off. Unamplified, it is the
// producer's own size.
export function produceEffects(c: Character, effects: SpellEffect[], size: number = getSize(c)): SpellEffect[] {
  return effects.map((e): SpellEffect => ({
    ...e,
    ...(e.type === 'damage' ? { effect: { ...e.effect, ...scaleDamage(e.effect.damage, e.scales.damage, size) } } : {}),
    area: e.area && e.scales.area ? scaleArea(e.area, getRMAt(size)) : e.area,
    range: e.range !== null && e.scales.reach ? Math.floor(e.range * getRMAt(size)) : e.range,
    scales: { damage: false, area: false, reach: false },
  }) as SpellEffect)
}

// "xDM": the damage at the spell's size.
function scaleDamage(damage: DamageComponent[], scaled: boolean, size: number): { damage: DamageComponent[] } {
  const scale = scaled ? getDMAt(size) : 1
  return { damage: damage.map((d) => ({ ...d, value: Math.floor(d.value * scale) })) }
}

// The effect stripped of its reach: what is delivered.
function bare(c: Character, effect: OutcomeEffect, size: number, onArea: boolean): Effect {
  const { name, trigger, type } = effect
  switch (type) {
    case 'damage': {
      // combat.tex "Intercept": force is compared against whoever met the
      // blow, which only means something for a single target — an area
      // effect's blast carries its own authored force, not the producer's.
      return { name, trigger, type, effect: DamageSchema.parse({
        ...effect.effect,
        ...scaleDamage(effect.effect.damage, effect.scales.damage, size),
        force: onArea ? effect.effect.force : getForce(c),
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
export function produceSpellEffect(c: Character, effect: SpellEffect, size: number = getSize(c), key: string | null = null): Delivery {
  const test = effect.resist ? { roll: effect.resist.roll, DL: resolveDL(c, effect.resist.dl, effect.resist.roll).value ?? 0 } : null
  return { effect: bare(c, effect, size, effect.target === 'area'), degree: test ? null : 'hit', test, when: null, then: [], locks: effect.duration === 'locked' ? key : null }
}

// spells.tex "Casting spells": what the target's own result on the spell's
// test lets through, as this caster makes it at the spell's size. The test
// is already rolled, so each lands as it is.
export function produceOutcome(c: Character, spell: Spell, degree: Degree, size: number = getSize(c)): Delivery[] {
  return (spell.outcomes?.[degree].effects ?? []).map((e) => ({ effect: bare(c, e, size, false), degree: 'hit', test: null, when: null, then: [], locks: null }))
}

// spells.tex "Extend Spell": "increase the casting range of a spell by
// +100%, then +200%, +300%" — the metres the caster can put an effect at,
// from the range at the spell's size; null is touch or self.
export function getCastRange(effect: SpellEffect, improved: Improvements, size: number): number | null {
  if (effect.range === null) return null
  const reach = effect.scales.reach ? Math.floor(effect.range * getRMAt(size)) : effect.range
  return reach * (1 + (improved.extend ?? 0))
}

export function getSelfEffects(spell: Spell): SpellEffect[] {
  return spell.effects.filter((e) => e.target === 'self')
}

export function getTargetEffects(spell: Spell): SpellEffect[] {
  return spell.effects.filter((e) => e.target === 'target')
}
