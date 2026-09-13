import { Ability, AbilitySchema, Activation, BuffTarget, Cost, Effect } from './types'
import { ABILITY_TEXT } from './abilities.generated'

// abilities.tex — the ability catalog. The prose (name, section, usage,
// description) is extracted from the book by tools/extract_abilities.py into
// abilities.generated.ts, one entry per stage; what each stage *does* to a
// number is authored here, keyed by the same ids. A stage's effects are the
// delta over the previous stage (Keen Eyes II is a second +1, not a +2), so a
// character with every stage learned sums to the book's "+1/2/3".
//
// An ability absent from this map is description-only: the reader sees it
// exists and reads how it works, and nothing in the domain moves for it yet.
//
// Every effect is stamped with its ability's key as `name`, which is how a
// toggled ability is found again in `activeEffects` to be switched off.
type EffectInput = Omit<Effect, 'id' | 'name'>

const buff = (target: BuffTarget, value: number): EffectInput =>
  ({ type: 'buff', trigger: 'instant', effect: { name: '', target, operation: '+', value } })

// A price paid at every round change while the ability stays on.
const upkeep = (cost: Partial<Cost>): EffectInput =>
  ({ type: 'cost', trigger: 'end_round', effect: { AP: 0, STA: 0, exhaustion: 0, IL: 0, ...cost } })

export type AbilityKey = keyof typeof ABILITY_TEXT

type Authored = { activation?: Activation; cost?: Cost; effect?: EffectInput[] }

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
  // The book files it as passive; it is a 1 AP reaction the character fires.
  'precise-reflexes': { activation: 'active', cost: { AP: 1, STA: 0, exhaustion: 0, IL: 0 } },

  // ── Melee Combat ──────────────────────────────────────────────────────
  'combo-1': { effect: [buff('surge:combat', 1)] },
  'combo-2': { effect: [buff('surge:combat', 1)] },

  // ── Convictions ───────────────────────────────────────────────────────
  // The +1 Will per odd conviction level is not an ability — it reads off the
  // conviction proficiency in getWillTerms. These come on top of it.
  'domination-1': { effect: [buff('skill:deception', 1), buff('skill:persuasion', 1)] },
  'fatalism-2': { effect: [buff('skill:will', 1)] },
  'fatalism-4': { effect: [buff('skill:will', 1)] },

  // ── Animancy ──────────────────────────────────────────────────────────
  // "+1 STA per turn" while the perimeter is held; stages II and III only
  // widen it, so the switch lives on stage I.
  'synesthesia-1': { activation: 'toggle', effect: [upkeep({ STA: 1 })] },

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
  'four-legs': { effect: [buff('skill:balance', 3)] },
}

export const ABILITIES: Record<AbilityKey, Ability> = Object.fromEntries(
  (Object.keys(ABILITY_TEXT) as AbilityKey[]).map((key) => {
    const authored = AUTHORED[key] ?? {}
    const effect = (authored.effect ?? []).map((e) => ({ ...e, name: key }))
    return [key, AbilitySchema.parse({ ...ABILITY_TEXT[key], ...authored, effect })]
  }),
) as Record<AbilityKey, Ability>

export const ABILITY_KEYS = Object.keys(ABILITY_TEXT) as AbilityKey[]

export function isAbilityKey(key: string): key is AbilityKey {
  return key in ABILITY_TEXT
}
