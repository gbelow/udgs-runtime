import { Spell, SpellSchema } from './types'
import { SPELL_TEXT } from './spells.generated'

// spells.tex — the spell catalog. Everything the book states is extracted by
// tools/extract_spells.py into spells.generated.ts; this module only adds what
// the book states as a rule rather than per spell.
//
// "Sustained Spells: The cost must be paid at the beginning of the next round
// to maintain the spell effect" — so a sustained spell's upkeep is its own
// casting cost, charged at every round change while it is held.
export type SpellKey = keyof typeof SPELL_TEXT

export const SPELLS: Record<SpellKey, Spell> = Object.fromEntries(
  (Object.keys(SPELL_TEXT) as SpellKey[]).map((key) => {
    const spell = SpellSchema.parse(SPELL_TEXT[key])
    if (spell.type !== 'sustained') return [key, spell]
    return [key, { ...spell, effect: [{ name: 'upkeep', type: 'cost', trigger: 'end_round', effect: spell.cost }] }]
  }),
) as Record<SpellKey, Spell>

export const SPELL_KEYS = Object.keys(SPELL_TEXT) as SpellKey[]

export function isSpellKey(key: string): key is SpellKey {
  return key in SPELL_TEXT
}
