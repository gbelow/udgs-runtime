import { Ability, AbilityInput, AbilitySchema, BuffTarget, EffectInput } from './types'
import { ABILITY_TEXT } from './abilities.generated'

// abilities.tex — the ability catalog. Everything the book states (name,
// section, usage and its cost, price, talent, requirements, description) is
// extracted by tools/extract_abilities.py into abilities.generated.ts, one
// entry per stage; what each stage *does* to a number is authored here, keyed
// by the same ids. A stage's effects are the delta over the previous stage
// (Keen Eyes II is a second +1, not a +2), so a character with every stage
// learned sums to the book's "+1|2|3".
//
// An ability absent from this map is description-only: the reader sees it
// exists and reads how it works, and nothing in the domain moves for it yet.
const buff = (target: BuffTarget, value: number): EffectInput =>
  ({ type: 'buff', effect: { target, operation: '+', value } })

export type AbilityKey = keyof typeof ABILITY_TEXT

type Authored = { effect: EffectInput[] }

const AUTHORED: Partial<Record<AbilityKey, Authored>> = {
  // ── Athletics ─────────────────────────────────────────────────────────
  'sprinter-1': { effect: [buff('movement:run', 1)] },
  'sprinter-2': { effect: [buff('movement:run', 1)] },
  'jumper-1': { effect: [buff('movement:jump', 1)] },
  'jumper-2': { effect: [buff('movement:jump', 1)] },

  // ── Ranged Combat ─────────────────────────────────────────────────────
  'elite-sniper-2': { effect: [buff('ap:snipe', -1)] },
  'quick-shooter-3': { effect: [buff('ap:quickShot', -1)] },
  'quick-reload-1': { effect: [buff('ap:reload', -1)] },
  'quick-reload-2': { effect: [buff('ap:reload', -1)] },

  // ── Melee Combat ──────────────────────────────────────────────────────
  'combo-1': { effect: [buff('surge:combat', 1)] },
  'combo-2': { effect: [buff('surge:combat', 1)] },

  // ── Convictions ───────────────────────────────────────────────────────
  // The +1 Will per odd conviction level is not an ability — it reads off the
  // conviction proficiency in getWillTerms. These come on top of it.
  'silver-tongue': { effect: [buff('skill:deception', 1), buff('skill:persuasion', 1)] },
  'iron-will-1': { effect: [buff('skill:will', 1)] },
  'iron-will-2': { effect: [buff('skill:will', 1)] },

  // ── Physical Transfiguration ──────────────────────────────────────────
  'keen-eyes-1': { effect: [buff('sense:vision', 1)] },
  'keen-eyes-2': { effect: [buff('sense:vision', 1)] },
  'keen-eyes-3': { effect: [buff('sense:vision', 1)] },
  'acute-ears-1': { effect: [buff('sense:hearing', 1)] },
  'acute-ears-2': { effect: [buff('sense:hearing', 1)] },
  'acute-ears-3': { effect: [buff('sense:hearing', 1)] },
  'sensitive-nose-1': { effect: [buff('sense:smell', 1)] },
  'sensitive-nose-2': { effect: [buff('sense:smell', 1)] },
  'sensitive-nose-3': { effect: [buff('sense:smell', 1)] },

  // ── Chimerism ─────────────────────────────────────────────────────────
  'tail-1': { effect: [buff('skill:balance', 1), buff('skill:climb', 1)] },
  'tail-2': { effect: [buff('skill:balance', 1), buff('skill:climb', 1)] },
}

export const ABILITIES: Record<AbilityKey, Ability> = Object.fromEntries(
  (Object.keys(ABILITY_TEXT) as AbilityKey[]).map((key) => {
    const text: AbilityInput = ABILITY_TEXT[key]
    // a sustained ability's upkeep comes from the book; the authored effects sit beside it
    return [key, AbilitySchema.parse({ ...text, effect: [...(text.effect ?? []), ...(AUTHORED[key]?.effect ?? [])] })]
  }),
) as Record<AbilityKey, Ability>

export const ABILITY_KEYS = Object.keys(ABILITY_TEXT) as AbilityKey[]

export function isAbilityKey(key: string): key is AbilityKey {
  return key in ABILITY_TEXT
}
