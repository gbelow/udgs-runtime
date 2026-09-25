import { z } from 'zod'
import { Spell, SpellEffectSchema, SpellSchema } from './types'
import catalog from '../assets/spells.json'

// spells.tex — the spell catalog, kept in app/assets/spells.json keyed by the
// slug of the spell's name; this module only adds what the book states as a
// rule rather than per spell.
//
// "Sustained Spells: The cost must be paid at the beginning of the next round
// to maintain the spell effect" — so a sustained spell's upkeep is its own
// casting cost, charged at every round change while it is held. The round
// change is combat's, where a spell costs only its AP and STA; what else it
// asks is exploration's.
export type SpellKey = keyof typeof catalog

const parsed: Record<SpellKey, Spell> = z.record(z.string(), SpellSchema).parse(catalog) as Record<SpellKey, Spell>

export const SPELLS: Record<SpellKey, Spell> = Object.fromEntries(
  (Object.keys(parsed) as SpellKey[]).map((key) => {
    const spell = parsed[key]
    if (spell.type !== 'sustained') return [key, spell]
    return [key, { ...spell, effects: [...spell.effects, SpellEffectSchema.parse({ name: 'upkeep', type: 'cost', trigger: 'end_round', effect: { AP: spell.cost.AP, STA: spell.cost.STA }, target: 'self', duration: 'held' })] }]
  }),
) as Record<SpellKey, Spell>

export const SPELL_KEYS = Object.keys(SPELLS) as SpellKey[]

export function isSpellKey(key: string): key is SpellKey {
  return key in SPELLS
}
