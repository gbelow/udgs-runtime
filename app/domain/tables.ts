// Rule tables: every constant here is a number the rules turn on. Components do
// not import this module (eslint enforces it) — a table that the UI needs is
// reached through a view getter, so the projection stays in the domain. Inert
// name lists live in `lists.ts`.

// combat.tex "Afflictions" groups skills into the categories a penalty can
// name. A skill may appear in more than one category (Exploration is both
// sensory and mental) and the categories then stack.
export const SkillPenaltyTable = {
  "sensory":[
    "strike",
    "defend",
    "accuracy",
    "reflex",
    "detection",
    "balance",
    "climb",
    "explore",
    "stealth",
    "prestidigitation",
  ],
  "mental":[
    "explore",
    "cunning",
    "will",
    "insight",
    "deception",
    "persuasion"
  ],
  "health":[
    "health",
  ],
}

export const SMArr = [-2,-1,0,1,2,3,4]
export const dmgArr = [0.5, 0.75, 1, 1.5, 2, 3, 4]

export const injuryMap: Record<string, { IL: number; woundChance: number }> = {
  T0: { IL: 1, woundChance: 0 },
  T1: { IL: 5, woundChance: 0 },
  T2: { IL: 10, woundChance: 0.5 },
  T3: { IL: 20, woundChance: 1 },
  T4: { IL: 30, woundChance: 1 },
  T5: { IL: 50, woundChance: 1 },
}

// combat.tex "Afflictions". Penalties are stored as positive magnitudes and
// negated where they are consumed, matching the gear catalogs.
//
// `group`/`rank` mark a severity ladder. The rulebook writes these as bands
// ("15 - 29 = Weakened", "= 30 = Malnourished", "Intoxicated I/II/III -1/2/3
// Mental"), so a character sits on exactly one rung of a group and the rungs
// never stack — see `getAfflictions`.
//
// The mobility afflictions carry no number: combat.tex states them as limits on
// what the character may do, not as modifiers. The one exception is `immobile`,
// whose "-5-1*SM" to hit is part of the SD getter, not a skill penalty.
//
// `controlable` is whether the affliction can be toggled by hand. The rungs
// that survival.tex derives from hunger, thirst and exhaustion are not: they
// are owned by their resource and clicking them does nothing.
export type AfflictionDef = {
  sensory?: number
  mental?: number
  health?: number
  group?: string
  rank?: number
  controlable: boolean
}

const AFFLICTION_DEFS = {
  lame: { controlable: true },
  prone: { controlable: true },
  grappled: { controlable: true },
  immobile: { controlable: true },

  disoriented: { sensory: 2, controlable: true },
  oblivious: { sensory: 5, controlable: true },
  blind: { controlable: true },
  deaf: { controlable: true },

  burning: { controlable: true },
  corroding0: { group: 'corroding', rank: 1, controlable: true },
  corroding1: { group: 'corroding', rank: 2, controlable: true },

  unconscious: { controlable: true },

  afraid: { mental: 1, controlable: true },
  enraged: { mental: 1, controlable: true },
  dominated: { controlable: true },

  intoxicated1: { mental: 1, group: 'intoxicated', rank: 1, controlable: true },
  intoxicated2: { mental: 2, group: 'intoxicated', rank: 2, controlable: true },
  intoxicated3: { mental: 3, group: 'intoxicated', rank: 3, controlable: true },

  // combat.tex lists Tired/Exhausted/Confused as one -1/-2/-4 mental ladder.
  // Confusion can also arrive on its own (spells, extreme exhaustion), which is
  // why it is the top rung rather than a separate affliction — and why it is
  // the one rung of this ladder that stays hand-settable.
  tired: { mental: 1, group: 'fatigue', rank: 1, controlable: false },
  exhausted: { mental: 2, group: 'fatigue', rank: 2, controlable: false },
  confused: { mental: 4, group: 'fatigue', rank: 3, controlable: true },

  weakened: { health: 1, group: 'hunger', rank: 1, controlable: false },
  malnourished: { health: 2, group: 'hunger', rank: 2, controlable: false },

  thirsty: { health: 1, group: 'thirst', rank: 1, controlable: false },
  dehydrated: { health: 2, group: 'thirst', rank: 2, controlable: false },

  sick: { health: 2, controlable: true },
} satisfies Record<string, AfflictionDef>

// Widened so every entry reads as the same shape; `keyof` still yields the
// literal key union that `AfflictionKey` is built from.
export const AFFLICTIONS: Record<keyof typeof AFFLICTION_DEFS, AfflictionDef> = AFFLICTION_DEFS

export const magic_types = {
  alchemy: {proficiency: 'sorcery', skill: 'alchemy'},
  animancy: { proficiency: 'sorcery', skill: 'animancy'},
  biomancy: {proficiency: 'sorcery', skill: 'biomancy'},
  divine: {proficiency: 'sorcery', skill: 'devotion'},
  miracle: {proficiency: 'devotion', skill: 'devotion'},
}

// combat.tex "Action surge" — one surge per round. Movement, combat and
// reaction share the same price and yield; only their spending restriction
// differs, which the table records as prose for the UI.
export const SURGES = {
  movement: { STA: 3, AP: 6, restriction: 'AP must be spent on movement immediately; allows running until the end of the turn.' },
  combat:   { STA: 3, AP: 6, restriction: 'AP must be spent immediately on attacks or movement.' },
  reaction: { STA: 3, AP: 6, restriction: 'AP can only be spent on reactions until the end of the round.' },
  focus:    { STA: 1, AP: 2, restriction: 'AP is free to use. Required for shooting weapons, spells and non-weapon items.' },
} as const
