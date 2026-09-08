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
  corroding2: { group: 'corroding', rank: 3, controlable: true },

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

// creating.tex "Areas of Knowledge" — the formal areas a character can train,
// in the rulebook's order. Commented-out entries there (Building, Politics,
// Botany, Physics) are deliberately absent.
export const knowledges_list = [
  'alchemy',
  'animancy',
  'biomancy',
  'shamanism',
  'mechanics',
  'smithing',
  'chemistry',
  'medicine',
  'linguistics',
  'navigation',
  'survival',
  'animal handling',
]


export const CONVICTIONS = {
  adaptation: {
    id: 'adaptation',
    name: 'Adaptation',
    
  },
  domination: {
    id: 'domination',
    name: 'Domination',
  },
  stoicism: {
    id: 'stoicism',
    name: 'Stoicism',
  },
  fatalism: {
    id: 'fatalism',
    name: 'Fatalism',
  },
  ferocity: {
    id: 'ferocity',
    name: 'Ferocity',
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
  },
  hedonism: {
    id: 'hedonism',
    name: 'Hedonism',
  },
  providentialism: {
    id: 'providentialism',
    name: 'Providencialism',
  },
}

