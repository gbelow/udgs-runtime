import { z } from 'zod'
import { Ability, AbilityFamily, AbilityFamilySchema, AbilitySchema } from './types'
import catalog from '../assets/abilities.json'

// abilities.tex — the ability catalog, kept in app/assets/abilities.json one
// family per entry (see AbilityFamilySchema) and expanded here into one
// catalog entry per stage. A stage's effects are the delta over the previous
// stage (Keen Eyes II is a second +1, not a +2), so a character with every
// stage learned sums to the book's "+1|2|3".
//
// A stage with no effects is description-only: the reader sees it exists and
// reads how it works, and nothing in the domain moves for it yet.
const ROMAN = ['I', 'II', 'III', 'IV', 'V']

type FamilyKey = keyof typeof catalog
export type AbilityKey = FamilyKey | `${FamilyKey}-${1 | 2 | 3 | 4 | 5}`

export const ABILITY_FAMILIES: Record<FamilyKey, AbilityFamily> = z.record(z.string(), AbilityFamilySchema).parse(catalog) as Record<FamilyKey, AbilityFamily>

// `<family>` for a single-stage ability, `<family>-<n>` for stage n of a
// multi-stage one; a stage requires the one before it and every ability its
// requirements name outright.
function expand(key: FamilyKey, family: AbilityFamily): [AbilityKey, Ability][] {
  const { stages, ...shared } = family
  return stages.map((stage, i) => {
    const staged = stages.length > 1
    const stageKey: AbilityKey = staged ? `${key}-${(i + 1) as 1 | 2 | 3 | 4 | 5}` : key
    const requires = stage.requirements.flatMap((item) => item.filter((alt) => alt.kind === 'ability' && !alt.not).map((alt) => alt.name))
    if (i > 0) requires.unshift(`${key}-${i}`)
    return [stageKey, AbilitySchema.parse({
      ...shared,
      ...stage,
      name: staged ? `${family.family} ${ROMAN[i]}` : family.family,
      stage: i + 1,
      requires,
    })]
  })
}

export const ABILITIES: Record<AbilityKey, Ability> = Object.fromEntries(
  (Object.keys(ABILITY_FAMILIES) as FamilyKey[]).flatMap((key) => expand(key, ABILITY_FAMILIES[key])),
) as Record<AbilityKey, Ability>

export const ABILITY_KEYS = Object.keys(ABILITIES) as AbilityKey[]

export function isAbilityKey(key: string): key is AbilityKey {
  return key in ABILITIES
}
