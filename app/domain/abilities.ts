import { Ability, AbilityInput, AbilitySchema } from './types'

// abilities.tex — the ability catalog, keyed by a stable id that
// Character.abilities holds. One entry per stage; a stage's effects are the
// delta over the previous stage (Keen Eyes II is a second +1, not a +2), so a
// character with every stage learned sums to the book's "+1/2/3".
//
// Stage rows carry only `requires` on the previous stage. The book's own
// cost/talent requirements are not enforced yet.
const CATALOG = {
  // ── DEX · Athletics ─────────────────────────────────────────────────────
  'sprinter-1': {
    name: 'Sprinter I', family: 'Sprinter', stage: 1, section: 'Athletics',
    usage: 'passive',
    description: 'Increases running speed by 1m xMM.',
    effect: [{ type: 'buff', name: 'Sprinter I', effect: { target: 'movement:run', value: 1 } }],
  },
  'sprinter-2': {
    name: 'Sprinter II', family: 'Sprinter', stage: 2, section: 'Athletics',
    usage: 'passive', requires: ['sprinter-1'],
    description: 'Increases running speed by 2m xMM.',
    effect: [{ type: 'buff', name: 'Sprinter II', effect: { target: 'movement:run', value: 1 } }],
  },
  'jumper-1': {
    name: 'Jumper I', family: 'Jumper', stage: 1, section: 'Athletics',
    usage: 'passive',
    description: 'Increases jump distance by 1m xMM.',
    effect: [{ type: 'buff', name: 'Jumper I', effect: { target: 'movement:jump', value: 1 } }],
  },
  'jumper-2': {
    name: 'Jumper II', family: 'Jumper', stage: 2, section: 'Athletics',
    usage: 'passive', requires: ['jumper-1'],
    description: 'Increases jump distance by 2m xMM.',
    effect: [{ type: 'buff', name: 'Jumper II', effect: { target: 'movement:jump', value: 1 } }],
  },

  // ── DEX · Ranged Combat ─────────────────────────────────────────────────
  // An unlock: it removes a penalty and enables actions the domain does not
  // model yet, so it is description-only.
  'archer': {
    name: 'Archer', family: 'Archer', stage: 1, section: 'Ranged Combat',
    usage: 'passive',
    description: 'Learns to shoot with bows, removing the penalty, and allows for quick shots and sniping.',
  },

  // ── DEX · Melee Combat ──────────────────────────────────────────────────
  'combo-1': {
    name: 'Combo I', family: 'Combo', stage: 1, section: 'Melee Combat',
    usage: 'passive',
    description: 'Combat surge gives +1 AP.',
    effect: [{ type: 'buff', name: 'Combo I', effect: { target: 'surge:combat', value: 1 } }],
  },
  'combo-2': {
    name: 'Combo II', family: 'Combo', stage: 2, section: 'Melee Combat',
    usage: 'passive', requires: ['combo-1'],
    description: 'Combat surge gives +2 AP.',
    effect: [{ type: 'buff', name: 'Combo II', effect: { target: 'surge:combat', value: 1 } }],
  },
  // A conditional buff: +2 only while adjacent to another shield bearer, which
  // the domain cannot see, so it is description-only.
  'shield-wall': {
    name: 'Shield Wall', family: 'Shield Wall', stage: 1, section: 'Melee Combat',
    usage: 'passive',
    description: 'Gains +2 to block if holding a shield and adjacent to another character with a shield.',
  },
  // An active ability: it has a price, and its effect is a combat procedure
  // rather than a number.
  'tackle': {
    name: 'Tackle', family: 'Tackle', stage: 1, section: 'Melee Combat',
    activation: 'active', usage: '4 AP + 1 STA', cost: { AP: 4, STA: 1 },
    description: 'Learns to initiate a grapple and perform a trample or knockdown in the same action.',
  },

  // ── Mutations · Physical Transfiguration ────────────────────────────────
  'keen-eyes-1': {
    name: 'Keen Eyes I', family: 'Keen Eyes', stage: 1, section: 'Physical Transfiguration',
    usage: 'passive',
    description: 'Improves vision by +1.',
    effect: [{ type: 'buff', name: 'Keen Eyes I', effect: { target: 'sense:vision', value: 1 } }],
  },
  'keen-eyes-2': {
    name: 'Keen Eyes II', family: 'Keen Eyes', stage: 2, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['keen-eyes-1'],
    description: 'Improves vision by +2.',
    effect: [{ type: 'buff', name: 'Keen Eyes II', effect: { target: 'sense:vision', value: 1 } }],
  },
  'keen-eyes-3': {
    name: 'Keen Eyes III', family: 'Keen Eyes', stage: 3, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['keen-eyes-2'],
    description: 'Improves vision by +3.',
    effect: [{ type: 'buff', name: 'Keen Eyes III', effect: { target: 'sense:vision', value: 1 } }],
  },
  'acute-ears-1': {
    name: 'Acute Ears I', family: 'Acute Ears', stage: 1, section: 'Physical Transfiguration',
    usage: 'passive',
    description: 'Improves hearing by +1.',
    effect: [{ type: 'buff', name: 'Acute Ears I', effect: { target: 'sense:hearing', value: 1 } }],
  },
  'acute-ears-2': {
    name: 'Acute Ears II', family: 'Acute Ears', stage: 2, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['acute-ears-1'],
    description: 'Improves hearing by +2.',
    effect: [{ type: 'buff', name: 'Acute Ears II', effect: { target: 'sense:hearing', value: 1 } }],
  },
  'acute-ears-3': {
    name: 'Acute Ears III', family: 'Acute Ears', stage: 3, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['acute-ears-2'],
    description: 'Improves hearing by +3.',
    effect: [{ type: 'buff', name: 'Acute Ears III', effect: { target: 'sense:hearing', value: 1 } }],
  },
  'sensitive-nose-1': {
    name: 'Sensitive Nose I', family: 'Sensitive Nose', stage: 1, section: 'Physical Transfiguration',
    usage: 'passive',
    description: 'Improves smell by +1.',
    effect: [{ type: 'buff', name: 'Sensitive Nose I', effect: { target: 'sense:smell', value: 1 } }],
  },
  'sensitive-nose-2': {
    name: 'Sensitive Nose II', family: 'Sensitive Nose', stage: 2, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['sensitive-nose-1'],
    description: 'Improves smell by +2.',
    effect: [{ type: 'buff', name: 'Sensitive Nose II', effect: { target: 'sense:smell', value: 1 } }],
  },
  'sensitive-nose-3': {
    name: 'Sensitive Nose III', family: 'Sensitive Nose', stage: 3, section: 'Physical Transfiguration',
    usage: 'passive', requires: ['sensitive-nose-2'],
    description: 'Improves smell by +3.',
    effect: [{ type: 'buff', name: 'Sensitive Nose III', effect: { target: 'sense:smell', value: 1 } }],
  },

  // ── Mutations · Chimerism ───────────────────────────────────────────────
  'tail-1': {
    name: 'Tail I', family: 'Tail', stage: 1, section: 'Chimerism',
    usage: 'passive',
    description: '+1 for balance and climbing.',
    effect: [
      { type: 'buff', name: 'Tail I', effect: { target: 'skill:balance', value: 1 } },
      { type: 'buff', name: 'Tail I', effect: { target: 'skill:climb', value: 1 } },
    ],
  },
  'tail-2': {
    name: 'Tail II', family: 'Tail', stage: 2, section: 'Chimerism',
    usage: 'passive', requires: ['tail-1'],
    description: '+2 for balance and climbing. Can hold things and hang with the tail.',
    effect: [
      { type: 'buff', name: 'Tail II', effect: { target: 'skill:balance', value: 1 } },
      { type: 'buff', name: 'Tail II', effect: { target: 'skill:climb', value: 1 } },
    ],
  },
} satisfies Record<string, AbilityInput>

export type AbilityKey = keyof typeof CATALOG

export const ABILITIES: Record<AbilityKey, Ability> = Object.fromEntries(
  Object.entries(CATALOG).map(([key, raw]) => [key, AbilitySchema.parse(raw)]),
) as Record<AbilityKey, Ability>

export const ABILITY_KEYS = Object.keys(CATALOG) as AbilityKey[]

export function isAbilityKey(key: string): key is AbilityKey {
  return key in CATALOG
}
