import { z } from 'zod'
import { Ability, AbilityFamily, AbilityFamilySchema, AbilitySchema, Character, Trainable, TrainableSchema } from './types'
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

export type FamilyKey = keyof typeof catalog
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

// The stages of a family in order, and the family a stage belongs to.
const FAMILY_STAGES = Object.fromEntries(
  (Object.keys(ABILITY_FAMILIES) as FamilyKey[]).map((family) => [family, expand(family, ABILITY_FAMILIES[family]).map(([key]) => key)]),
) as Record<FamilyKey, AbilityKey[]>

export const ABILITY_FAMILY_OF = Object.fromEntries(
  (Object.keys(FAMILY_STAGES) as FamilyKey[]).flatMap((family) => FAMILY_STAGES[family].map((key) => [key, family])),
) as Record<AbilityKey, FamilyKey>

export function getFamilyStages(family: FamilyKey): AbilityKey[] {
  return FAMILY_STAGES[family]
}

function isFamilyKey(key: string): key is FamilyKey {
  return key in ABILITY_FAMILIES
}

// abilities.tex "Acquiring abilities": an ability is held as a trainable of
// its family, its level the stages learned. At level 0 it is being trained
// and none of it is learned yet.
export function getAbilityLevel(c: Character, family: FamilyKey): number {
  return c.abilities[family]?.value ?? 0
}

// A family held at a level, with nothing trained yet toward the next.
export function heldAbility(family: string, value = 0): Trainable {
  return TrainableSchema.parse({ name: family, type: 'ability', value })
}

export function hasAbility(c: Character, key: string): boolean {
  return isAbilityKey(key) && getAbilityLevel(c, ABILITY_FAMILY_OF[key]) >= ABILITIES[key].stage
}

// Every stage learned. A family saved before a rename is skipped rather than
// thrown on.
export function getLearnedAbilityKeys(c: Character): AbilityKey[] {
  return Object.keys(c.abilities).filter(isFamilyKey).flatMap((family) => FAMILY_STAGES[family].slice(0, getAbilityLevel(c, family)))
}
