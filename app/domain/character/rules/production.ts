import { DamageSchema, type Area, type Character, type DamageComponent, type Degree, type Delivery, type Effect, type Item, type OutcomeEffect, type SpellEffect } from '../../types'
import { getSourceDamage } from '../../item/rules/items'
import type { SpellModification } from '../../tables'
import { getDMAt, getRMAt, getSize } from './size'
import { getForce } from './skills'
import { getSpellGear, resolveDL } from './spells'
import { SPELLS, getSpellOutcomes, type LoadedSpell, type SpellKey } from '../../spells'
import { produceSpiritAttack } from './spirit'

// spells.tex "Casting spells": what a spell produces once it is cast — its
// effects as this caster makes them, every number resolved, each on its way
// to whoever it is aimed at. The caster's part ends here: a delivery with a
// test is the target's to roll.

export type Improvements = Partial<Record<SpellModification, number>>

// creating.tex "Reach Multiplier": "xRM" — an area at the spell's size.
function scaleArea(area: Area, RM: number): Area {
  return area.shape === 'explosion'
    ? { ...area, radius: Math.floor(area.radius * RM) }
    : { shape: 'spray', length: Math.floor(area.length * RM), angle: area.angle }
}

// The spell's effects as cast with this gear: a damage drawn from the gear
// is the gear's own times the spell's factor. The gear is only looked up
// for a spell that draws on it.
export function getSpellEffects(c: Character, key: SpellKey, itemId = ''): SpellEffect[] {
  const { effects } = SPELLS[key]
  return effects.some(drawsOnGear) ? drawOnGear(effects, getSpellGear(c, key, itemId)) : effects
}

function drawsOnGear(e: SpellEffect): boolean {
  return e.type === 'damage' && e.fromGear !== null
}

export function drawOnGear(effects: SpellEffect[], gear: Item | null): SpellEffect[] {
  return effects.map((e): SpellEffect => (e.type === 'damage' && e.fromGear !== null ? { ...e, effect: { ...e.effect, damage: getSourceDamage(gear, e.fromGear) } } : e))
}

// spells.tex "Healing Food": "giving half of its nutritional value as IL
// healing" — a heal's share of the nutrition of the portion it is charged
// into.
export function drawOnFood(effects: SpellEffect[], food: Item): SpellEffect[] {
  return effects.map((e): SpellEffect => (e.type === 'heal' && e.effect.nutrition !== 0
    ? { ...e, effect: { ...e.effect, amount: e.effect.amount + Math.floor(e.effect.nutrition * (food.food ?? 0)) } }
    : e))
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

// The test each effect asks of its target, worked out as a number: what a
// charge carries too, so nobody who releases it needs its maker.
export function settleTests(c: Character, effects: SpellEffect[]): SpellEffect[] {
  return effects.map((e): SpellEffect => (e.resist ? { ...e, resist: { ...e.resist, dl: String(resolveDL(c, e.resist.dl, e.resist.roll).value ?? 0) } } : e))
}

// "xDM": the damage at the spell's size.
function scaleDamage(damage: DamageComponent[], scaled: boolean, size: number): { damage: DamageComponent[] } {
  const scale = scaled ? getDMAt(size) : 1
  return { damage: damage.map((d) => ({ ...d, value: Math.floor(d.value * scale) })) }
}

// The effect stripped of its reach: what is delivered.
function bare(c: Character | null, effect: OutcomeEffect, size: number, onArea: boolean): Effect {
  const { name, trigger, type } = effect
  switch (type) {
    case 'damage': {
      // combat.tex "Intercept": force is compared against whoever met the
      // blow, which only means something for a single target — an area
      // effect's blast carries its own authored force, not the producer's.
      return { name, trigger, type, effect: DamageSchema.parse({
        ...effect.effect,
        ...scaleDamage(effect.effect.damage, effect.scales.damage, size),
        force: onArea || c === null ? effect.effect.force : getForce(c),
      }) }
    }
    case 'affliction': return { name, trigger, type, effect: effect.effect }
    case 'terrain': return { name, trigger, type, effect: effect.effect }
    case 'tether': return { name, trigger, type, effect: effect.effect }
    case 'cost': return { name, trigger, type, effect: effect.effect }
    case 'buff': return { name, trigger, type, effect: effect.effect }
    case 'suppression': return { name, trigger, type, effect: effect.effect }
    case 'heal': return { name, trigger, type, effect: effect.effect }
  }
}

// spells.tex "Enhance Spell": "the special improvement described in the
// spell", each one adding the effect's `enhance` to its number.
export function enhanceEffect<E extends SpellEffect>(effect: E, enhanced: number): E {
  const more = effect.enhance * enhanced
  if (more === 0) return effect
  if (effect.type === 'heal') return { ...effect, effect: { ...effect.effect, amount: effect.effect.amount + more } }
  if (effect.type === 'buff') return { ...effect, effect: { ...effect.effect, value: effect.effect.value + more } }
  return effect
}

// `locks` names the spell a locked effect is carried under (spells.tex
// "Curse"), so the target can read it off the catalog and beat it.
export function produceSpellEffect(c: Character, effect: SpellEffect, size: number = getSize(c), key: string | null = null, enhanced = 0): Delivery {
  if (effect.type === 'spirit') return produceSpiritAttack(c)
  const test = effect.resist ? { roll: effect.resist.roll, DL: (resolveDL(c, effect.resist.dl, effect.resist.roll).value ?? 0) + effect.resist.enhance * enhanced } : null
  return { effect: bare(c, enhanceEffect(effect, enhanced), size, effect.target === 'area'), degree: test ? null : 'hit', test, when: null, then: [], locks: effect.duration === 'locked' ? key : null }
}

// An area effect nobody produced (the GM's), delivered as written: no size
// scales it and no test rides on it.
export function produceUnownedEffect(effect: Exclude<SpellEffect, { type: 'spirit' }>): Delivery {
  return { effect: bare(null, effect, 0, true), degree: 'hit', test: null, when: null, then: [], locks: null }
}

// An effect landing as it is, with no test to make and nothing following.
export function landed(effect: Effect): Delivery {
  return { effect, degree: 'hit', test: null, when: null, then: [], locks: null }
}

// spells.tex "Casting spells": what the target's own result on the spell's
// test lets through, as this caster makes it at the spell's size. The test
// is already rolled, so each lands as it is.
export function produceOutcome(c: Character, spell: LoadedSpell, degree: Degree, size: number = getSize(c)): Delivery[] {
  return (getSpellOutcomes(spell)?.[degree].effects ?? []).map((e) => landed(bare(c, e, size, false)))
}

// spells.tex "Extend Spell": "increase the casting range of a spell by
// +100%, then +200%, +300%" — the metres the caster can put an effect at,
// from the range at the spell's size and the extensions declared; null is
// touch or self.
export function getCastRange(effect: SpellEffect, extend: number, size: number): number | null {
  if (effect.range === null) return null
  const reach = effect.scales.reach ? Math.floor(effect.range * getRMAt(size)) : effect.range
  return reach * (1 + extend)
}

export function getTargetEffects(effects: SpellEffect[]): SpellEffect[] {
  return effects.filter((e) => e.target === 'target')
}
