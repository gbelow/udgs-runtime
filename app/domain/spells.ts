import { z } from 'zod'
import { Spell, SpellEffect, SpellEffectSchema, SpellSchema, type MoraleSpellEffect, type SpellOutcomes, type TestSpellEffect, type TriggerSpellEffect } from './types'
import catalog from '../assets/spells.json'

// spells.tex — the spell catalog, kept in app/assets/spells.json keyed by the
// slug of the spell's name; this module only adds what the book states as a
// rule rather than per spell.
//
// "Sustained Spells: The cost must be paid at the beginning of the next round
// to maintain the spell effect" — so a sustained spell's upkeep is its own
// casting cost, charged at every round change while it is held, unless the
// spell names an upkeep of its own. The round change is combat's, where a
// spell costs only its AP and STA; what else it asks is exploration's.
export type SpellKey = keyof typeof catalog

export function getSpellUpkeep(spell: Spell): { AP: number; STA: number } {
  const { AP, STA } = spell.upkeep ?? spell.cost
  return { AP, STA }
}

const parsed: Record<SpellKey, Spell> = z.record(z.string(), SpellSchema).parse(catalog) as Record<SpellKey, Spell>

// A spell as the book plays it: the effects it delivers, and apart from them
// the one that puts its target to a test (a morale test, combat.tex "Morale",
// or one whose degree picks an outcome) and the one that sets off a charge,
// which are opened in the fight and deliver nothing.
export type LoadedSpell = Omit<Spell, 'effects'> & { effects: SpellEffect[]; morale: MoraleSpellEffect | null; forced: TestSpellEffect | null; activates: TriggerSpellEffect | null }

// What the target suffers at each degree of the spell's test.
export function getSpellOutcomes(spell: LoadedSpell): SpellOutcomes | null {
  return spell.forced?.effect.outcomes ?? null
}

export const SPELLS: Record<SpellKey, LoadedSpell> = Object.fromEntries(
  (Object.keys(parsed) as SpellKey[]).map((key) => {
    const spell = parsed[key]
    const { AP, STA } = getSpellUpkeep(spell)
    const delivered = spell.effects.filter((e): e is SpellEffect => e.type !== 'morale' && e.type !== 'test' && e.type !== 'trigger')
    const morale = spell.effects.find((e): e is MoraleSpellEffect => e.type === 'morale') ?? null
    const forced = spell.effects.find((e): e is TestSpellEffect => e.type === 'test') ?? null
    const activates = spell.effects.find((e): e is TriggerSpellEffect => e.type === 'trigger') ?? null
    const base = { ...spell, effects: delivered, morale, forced, activates }
    if (spell.type !== 'sustained' || (AP === 0 && STA === 0)) return [key, base]
    return [key, { ...base, effects: [...delivered, SpellEffectSchema.parse({ name: 'upkeep', type: 'cost', trigger: 'end_round', effect: { AP, STA }, target: 'self', duration: 'held' })] }]
  }),
) as Record<SpellKey, LoadedSpell>

export const SPELL_KEYS = Object.keys(SPELLS) as SpellKey[]

export function isSpellKey(key: string): key is SpellKey {
  return key in SPELLS
}
