import { HIT_LOCATIONS, HOP_PURCHASES, MATERIALS, PART_FLAGS, SHOT_RANGES, WOUND_EFFECTS, type ChaseTier, type FootprintPreset, type LimitStressAction, type LivingLevel } from './lists'
import type { SpellKey } from './spells'
import type { AfflictionKey, Coord, Degree, Fuel, MeleeRange, MovementKind, Priority, WeaponProperty } from './types'

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

// combat.tex "Fire": the burning damage a flammable surface causes when it
// covers the same space as a character ("Burning Oil/Alcohol").
export const FUEL_BURN: Record<Fuel, number> = { oil: 8, alcohol: 8 }

// combat.tex "End of the round": "all characters get reset to 8 AP minus
// any negative AP they had".
export const ROUND_AP = 8

// combat.tex "Start": "rounds, which represent 3 seconds of game time each".
export const ROUND_SECONDS = 3

// combat.tex "Running": how long a chase round run at each tier lasts, in
// seconds — a dash "around 30 seconds" (routing at that range too), a
// sustained pace "1 minute in shooting distance and 5 minutes at higher
// distances".
export const CHASE_ROUND_SECONDS = { combat: 30, shooting: 60, far: 300, horizon: 300 } as const satisfies Record<ChaseTier, number>

// combat.tex "Chases": the distance between the sides at each tier past
// combat range, in metres — a skirmish at 50 m (the table's ruling), far and
// horizon where the book starts them ("Far: This is from around 200m",
// "Horizon: This is from 500m"). In combat range "Everyone is considered to
// be in range to attack or defend anyone".
export const CHASE_TIER_METRES = { shooting: 50, far: 200, horizon: 500 } as const satisfies Record<Exclude<ChaseTier, 'combat'>, number>

// combat.tex "Skirmish": "A round lasts 30 seconds". "Everyone has 18 AP" when
// both teams shoot; "The approaching team gets 8 AP and must spend a movement
// surge for running. The shooting team gets 18 AP and spends their focus
// surge."
export const SKIRMISH_SECONDS = 30
export const SKIRMISH_SHOOT_AP = 18
export const SKIRMISH_APPROACH_AP = 8

// combat.tex "Cover": "For the ones who decide to shoot or move, cover is
// partial, with a bonus of +3 to reflexes by default."
export const CHASE_PARTIAL_COVER_REFLEX = 3

export const SMArr = [-2,-1,0,1,2,3,4]
export const dmgArr = [0.5, 0.75, 1, 1.5, 2, 3, 4]
// creating.tex "Reach Multiplier (RM)": multiplies the range of all weapons.
export const RMArr = [0.5, 1, 1, 1.5, 1.5, 2, 2.5]
// creating.tex "Volume Multiplier (VM)": multiplies the weight of the
// character and items when scaling.
export const VMArr = [0.1, 0.33, 1, 3.33, 10, 33.3, 100]

// creating.tex "Size and Space Occupation": "A creature of size 3 in human
// form occupies 1 ... hexagon. For every 2 size categories ... a hexagonal
// grid will occupy 3 spaces ..., then 7." Indexed by size - 1; the sizes
// between two steps keep the lower step's count.
export const FOOTPRINT_CELLS = [1, 1, 1, 1, 3, 3, 7] as const
export type FootprintCells = (typeof FOOTPRINT_CELLS)[number]

// Footprints to start a creature's from, at each count, as offsets from the
// anchor cell in orientation 0 (facing `geometry.ts` direction 0); the
// placement's orientation turns them. The 3-cell blob is the book's token "in
// the middle of 3"; a line is a creature that is long rather than wide.
export const PRESET_CELLS: Record<FootprintPreset, Record<FootprintCells, readonly Coord[]>> = {
  blob: {
    1: [{ q: 0, r: 0 }],
    3: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
    7: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }],
  },
  line: {
    1: [{ q: 0, r: 0 }],
    3: [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }],
    7: [{ q: -3, r: 0 }, { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
  },
}

// combat.tex "Movement Costs and Speeds": what a block of each movement costs
// and how far it goes, the defaults of a character's `movement`. Running "can
// run a partial amount smaller than its running speed, but AP cost is the
// same", and a jump cannot be interrupted, so both are bought whole. A
// block of standing up crosses no cells; its AP is "5 -AGI/5". "Climbing":
// "The climbing speed is equal to the crawling speed but costs 3 AP + 1 STA".
export type MovementBlock = { AP: number; STA: number; distance: number }
export const MOVEMENT_BLOCKS: Record<MovementKind | 'stand' | 'fast swim', MovementBlock> = {
  careful:     { AP: 2, STA: 0, distance: 1 },
  basic:       { AP: 1, STA: 0, distance: 1 },
  run:         { AP: 2, STA: 1, distance: 3 },
  jump:        { AP: 2, STA: 1, distance: 2 },
  crawl:       { AP: 3, STA: 0, distance: 1 },
  climb:       { AP: 3, STA: 1, distance: 1 },
  swim:        { AP: 3, STA: 0, distance: 1 },
  stand:       { AP: 5, STA: 1, distance: 0 },
  'fast swim': { AP: 1, STA: 0, distance: 0.5 },
}

// combat.tex "Climbing": "On a critical, it does not cost STA"; "On a graze,
// ... 5 AP +1 STA per meter" — what a block of AP comes to on a graze.
// abilities.tex "Climber II": "make climbing speed equal to 1m per AP" on a
// crit, risky. "An easy climb, with minimal chances of falling, is considered
// a DL of 5", where a face is first painted.
export const CLIMB_GRAZE_AP = 5
export const CLIMB_RISKY_AP = 1
export const CLIMB_EASY_DL = 5

// combat.tex "Damage absorption": the RES a wall nothing breaks is given
// when it is first made breakable, a wooden shield's and a half (gear.tex
// "Shields"), the table's call.
export const COVER_START_RES = 30

// combat.tex "Climbing": an interrupted climber makes "a climbing test with a
// -3 penalty to avoid falling on a miss"; "climbing with only one hand, claw or
// other climbing equipment incurs a -3 penalty. Climbing without any gives a
// -8 penalty".
export const CLIMB_REDO_PENALTY = 3
export const CLIMB_ONE_HAND_PENALTY = 3
export const CLIMB_NO_HAND_PENALTY = 8

// combat.tex "Choosing Fall DL": "As a common exception to the rule, DLs for
// 1m can be considered trivial at -5, then 0 for 2m", else "1 per meter until
// a maximum of 15"; "Fall damage": "2x fall height x DM^2 ... Maximum height
// is capped at 50m".
export const FALL = {
  minHeight: 1,
  maxHeight: 50,
  maxDL: 15,
  DLAtMinHeight: -5,
  DLAtTwoMetres: 0,
  damagePerMetre: 2,
  // "Fall skill test": a critical "reduce[s] the damage by 50%"; abilities.tex
  // "Gymnast III": "reduced to 25% on a crit"
  critShare: 0.5,
  gymnastCritShare: 0.25,
} as const

// combat.tex "Fall damage": DM squared by size, "For size 2, instead of
// making 0.75^2, just use 0.5. For size 4, instead of 1.5^2, use 2."
export const FALL_DM2 = [0.25, 0.5, 1, 2, 4, 9, 16] as const

// combat.tex "Swimming": a graze or a failed swimming test is "1m per 5 AP",
// and a failure adds "+1STA" to it. The AP is per metre; the STA is
// per metre swum. A failure also "sinks 1m", and gear.tex "Metallic armors"
// sink the swimmer "1m per turn".
export const SWIM_STRUGGLE_AP = 5
export const SWIM_DEFAULT_DL = -2
export const SWIM_FAILURE_STA = 1
export const SWIM_FAILURE_SINK = 1
export const SWIM_ARMOR_SINK = 1
// combat.tex "Swimming": "Characters attempting to swim with one hand receive
// a -3 penalty on the test."
export const SWIM_ONE_HAND_PENALTY = -3

// gear.tex "Short, Long I/II": "Short-range attacks ... have a range of 1m x
// RM. Long-range attacks have an extended range of 1m x RM per level." The
// metres before the RM.
export const REACH: Record<MeleeRange, number> = {
  short: 1,
  'long I': 2,
  'long II': 3,
}

// combat.tex "Visibility": "Bad visibility applies -2 visibility penalties to
// anyone targeting them".
export const BAD_VISIBILITY_PENALTY = -2

// spells.tex "Lamp", "Revealing Light": the light radius, in metres, a cast
// leaves in its alchemical torch for the rest of the fight (the table's
// ruling for "1 ET").
export const SPELL_LIGHT: Record<string, number> = {
  lamp: 5,
  'revealing-light': 10,
}

// combat.tex "Fog and smoke": "Opaque gases reduce vision radius of anyone
// inside of it to 2m by default".
export const FOG_VISION_RADIUS = 2

// combat.tex "Damage Tiers": the IL and bleed each tier inflicts; the
// threshold column is armor + tier x TGH and is computed where it is needed.
export const injuryMap: Record<string, { IL: number; bleed: number }> = {
  T0: { IL: 1, bleed: 0 },
  T1: { IL: 5, bleed: 0 },
  T2: { IL: 10, bleed: 1 },
  T3: { IL: 20, bleed: 2 },
  T4: { IL: 30, bleed: 3 },
  T5: { IL: 50, bleed: 4 },
}
export const MAX_TIER = 5

// combat.tex "Success Overflow" and "Localized damage" (the hand switch): what
// a hit's HOP can buy. `cost` is a number of HOP or the target's deflection;
// `property` is the weapon property that allows the effect (gear.tex "Weapons
// Properties"), null where any weapon may. Smash is open to any weapon and
// has no gate but its price: its own extra damage may be what makes the
// blow T1, so the stun it upgrades is read off the outcome, not asked for
// up front. combat.tex "Assassinate", "Braced Attack" and "Hook Attack" (the
// trip) cost no HOP but AP and STA, priced in ACTION_COSTS.
export const HOP_EFFECTS = {
  slice:       { cost: 1,            property: 'bladed' },
  bypass:      { cost: 'deflection', property: 'precise' },
  bust:        { cost: 'deflection', property: 'penetrating' },
  smash:       { cost: 'deflection', property: null },
  handSwitch:  { cost: 3,            property: null },
  assassinate: { cost: 0,            property: 'precise' },
  braced:      { cost: 0,            property: 'braced' },
  hook:        { cost: 0,            property: 'hook' },
} as const satisfies Record<(typeof HOP_PURCHASES)[number], { cost: number | 'deflection'; property: WeaponProperty | null }>

// combat.tex "Interruption", "Stun": an interruption costs nothing beyond
// the action it cuts short; a stun is an interruption "in which the target
// also loses 2 AP", and happens on its own at T3+ blunt.
export const STUN_AP = 2
export const STUN_TIER = 3

// combat.tex "Standard Action": "throwing items with bulk smaller than
// character size by up to 10m"
export const THROW_ITEM_RANGE = 10

// combat.tex "Wounds" table, as the wounds a part can take: `tier` the
// lowest tier at the part that causes it, `heal` the IL wound to heal it
// away, `consequence` the table's own words for what it does. A `disable`
// wound is carried in the injuries and puts its part out of use (a hand's or
// a leg's consequence is read off the body, body.ts); `affliction` is only
// what reaches past the part. A `sever` wound ("no heal") is not carried: the
// part it takes is lost. `smash` wounds are measured on the blunt tier and
// need a smash (Shocked). combat.tex "Head": "Tier 4 damage causes instant
// death" is the head's `kill`.
type PartWoundPreset = { name: string; tier: number; smash: boolean; effect: (typeof WOUND_EFFECTS)[number]; heal: number; affliction: AfflictionKey | null; consequence: string }

const wound = (w: Partial<PartWoundPreset> & Pick<PartWoundPreset, 'name' | 'tier' | 'consequence'>): PartWoundPreset =>
  ({ smash: false, effect: 'disable', heal: 0, affliction: null, ...w })

// combat.tex "Localized damage", the humanoid's places: the penalty to the
// attack test for aiming there, stored as a positive magnitude; the highest
// injury tier the body takes from a hit there (`null` when the book sets no
// cap); what the part does (`PART_FLAGS`); and the wounds it takes. A body
// part of each kind starts from its row; `other` is a place the book does
// not describe, starting from nothing.
export const PART_PRESETS = {
  chest: { aimPenalty: 0, maxTier: null, flags: [], wounds: [
    wound({ name: 'shocked', tier: 3, smash: true, heal: 5, affliction: 'immobile', consequence: 'immobile' }),
  ] },
  hand: { aimPenalty: 10, maxTier: 2, flags: ['bareWithoutGauntlets'], wounds: [
    wound({ name: 'broken hand', tier: 2, heal: 10, consequence: 'useless hand' }),
    wound({ name: 'amputated hand', tier: 4, effect: 'sever', consequence: 'loses hand' }),
  ] },
  leg: { aimPenalty: 0, maxTier: 3, flags: [], wounds: [
    wound({ name: 'broken leg', tier: 3, heal: 20, consequence: 'lame' }),
    wound({ name: 'amputated leg', tier: 5, effect: 'sever', consequence: 'loses leg' }),
  ] },
  head: { aimPenalty: 5, maxTier: null, flags: ['stunUnconscious', 'bypassToFlesh'], wounds: [
    wound({ name: 'death', tier: 4, effect: 'kill', consequence: 'instant death' }),
  ] },
  other: { aimPenalty: 0, maxTier: null, flags: [], wounds: [] },
} as const satisfies Record<(typeof HIT_LOCATIONS)[number], { aimPenalty: number; maxTier: number | null; flags: readonly (typeof PART_FLAGS)[number][]; wounds: readonly PartWoundPreset[] }>

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
// `supersedes` names a ladder this affliction replaces outright while it is
// on: the ladder's rungs drop out of the derived set instead of stacking.
//
// `controlable` is whether the affliction can be toggled by hand. The rungs
// that survival.tex derives from hunger, thirst and exhaustion are not: they
// are owned by their resource and clicking them does nothing. Neither is
// prone: it is taken and left by moving (combat.tex "Movement": "Stand up:
// Removes the prone condition").
//
// `category` is the heading the affliction sits under on the sheet. It is a UI
// grouping, distinct from the penalty categories combat.tex names.
export type AfflictionCategory = 'mobility' | 'sensory' | 'damage' | 'mental' | 'health'

// combat.tex "Afflictions": "Offuscated/Blind: -3 to sensory penalties when
// using vision/ Cannot use vision" — a sense made worse by `penalty`, or lost.
export type AfflictedSense = { key: 'vision' | 'hearing'; penalty?: number; lost?: boolean }

export type AfflictionDef = {
  sensory?: number
  sense?: AfflictedSense
  mental?: number
  health?: number
  group?: string
  rank?: number
  supersedes?: string
  controlable: boolean
  category: AfflictionCategory
  hidden?: boolean
}

// Display order of the headings.
export const AFFLICTION_CATEGORIES: AfflictionCategory[] = ['mobility', 'sensory', 'damage', 'mental', 'health']

const AFFLICTION_DEFS = {
  lame: { controlable: true, category: "mobility" },
  prone: { controlable: false, category: "mobility" },
  grappled: { controlable: true, category: "mobility" },
  immobile: { controlable: true, category: "mobility" },

  offuscated: { sense: { key: 'vision', penalty: 3 }, group: 'sight', rank: 1, controlable: true, category: "sensory" },
  blind: { sense: { key: 'vision', lost: true }, group: 'sight', rank: 2, controlable: true, category: "sensory" },
  muffled: { sense: { key: 'hearing', penalty: 3 }, group: 'hearing', rank: 1, controlable: true, category: "sensory" },
  deaf: { sense: { key: 'hearing', lost: true }, group: 'hearing', rank: 2, controlable: true, category: "sensory" },

  corroding0: { group: 'corroding', rank: 1, controlable: true, category: "damage", hidden: true },
  corroding1: { group: 'corroding', rank: 2, controlable: true, category: "damage", hidden: true },

  unconscious: { controlable: true, category: "mental" },

  afraid: { mental: 1, controlable: true, category: "mental" },
  enraged: { mental: 1, controlable: true, category: "mental" },
  dominated: { controlable: true, category: "mental" },

  intoxicated1: { mental: 1, group: 'intoxicated', rank: 1, controlable: true, category: "health" },
  intoxicated2: { mental: 2, group: 'intoxicated', rank: 2, controlable: true, category: "health" },
  intoxicated3: { mental: 3, group: 'intoxicated', rank: 3, controlable: true, category: "health" },

  // combat.tex: confusion is its own mental affliction, not the top rung of the
  // fatigue ladder — "it is possible to be confused without being tired or
  // exhausted, but extreme exhaustion causes confusion" (survival.tex "> 11 =
  // Confused + Exhausted"), so the two penalties stack.
  tired: { mental: 1, group: 'fatigue', rank: 1, controlable: false, category: "health" },
  exhausted: { mental: 2, group: 'fatigue', rank: 2, controlable: false, category: "health" },
  confused: { mental: 3, controlable: true, category: "mental" },

  weakened: { health: 1, group: 'hunger', rank: 1, controlable: false, category: "health" },
  malnourished: { health: 2, group: 'hunger', rank: 2, controlable: false, category: "health" },

  thirsty: { health: 1, group: 'thirst', rank: 1, controlable: false, category: "health" },
  dehydrated: { health: 2, group: 'thirst', rank: 2, controlable: false, category: "health" },

  sick: { health: 2, controlable: true, category: "health" },

  // combat.tex "Suffocation": no skill penalty; it costs 1 STA at the start of
  // every round and forbids Rest (both handled by the commands that own them).
  suffocating: { controlable: true, category: "damage" },
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

// play.tex "Degrees of success": a hit is the DL + 5, and spells.tex "Casting
// spells" converts every point above a hit into a HOP. Reaching n HOPs on
// a cast therefore means beating DL + HIT_MARGIN + n.
export const HIT_MARGIN = 5

// spells.tex "Types of Spells and Modifications" — what each improvement
// costs in HOPs, chosen after the roll. Quicken and Extend are not here:
// they are decided before the roll and move the DL instead (QUICKEN_DL,
// EXTEND).
export const SPELL_MODIFICATIONS = {
  enhance:    { HOP: 4, text: 'the special improvement described in the spell' },
  amplify:    { HOP: 5, text: 'cast one size larger: damage by DM, reach and area by RM; up to 1 size above the item' },
  effortless: { HOP: 6, text: 'rest while casting: STA/4 back, AP raised to the rest cost, careful movement; halves the exhaustion cost out of combat' },
} as const satisfies Record<string, { HOP: number; text: string }>

// "Quicken Spell: Increases spell DL by 3 to allow it to be cast during any
// surge and not cause opportunity attacks."
export const QUICKEN_DL = 3

// "Extend Spell: Spend 3 HOPs to increase the casting range of a spell by
// +100%, then +200%, +300%" — bought before the roll, not after it (the
// table's ruling), its 3 HOPs as 3 DL per extension.
export const EXTEND = { DL: 3, text: 'casting range +100% per extension' } as const

// spells.tex "Casting spells": a graze in combat may "increase spell cost by
// 2 AP to gain +3 once in the test".
export const GRAZE_SAVE = { AP: 2, bonus: 3 } as const

export type SpellModification = keyof typeof SPELL_MODIFICATIONS

// combat.tex "Action surge": what an earmarked surge's AP may pay for, each
// a group of actions (scene/rules/surge.ts) named as the book names it.
// "grapple" is "any action within a grapple": everything, for one in one.
export const SURGE_ALLOWANCES = {
  movement: 'movement',
  reactions: 'reactions',
  attacks: 'melee attacks',
  defenses: 'defenses',
  reflexes: 'reflexes',
  grapple: 'any action within a grapple',
} as const
export type SurgeAllowance = keyof typeof SURGE_ALLOWANCES

// combat.tex "Action surge" — one surge per round. Each kind prices its AP
// in STA; the movement surge alone scales its yield with AGI, so the yield
// column is a function of AGI rather than a number. An `earmarked` surge's AP
// is kept apart from the rest: until it is spent, ended or the turn ends,
// only what it `allows` can be done; as the table rules it, such a surge is
// made only in the character's own turn. The movement surge allows
// "movement and reactions", a push or a drag not among them (the table's
// ruling); the combat surge "attacks, movement, or any action within a
// grapple", and — the table's ruling — defenses and reflexes. The reaction
// surge's AP is free, but no turn can be started after it. What else
// restricts a surge is recorded as prose for the UI. `forbiddenBy` is the
// affliction under which the surge cannot be made voluntarily (combat.tex
// "Afflictions": afraid bars the combat surge, enraged the reaction surge).
export const SURGES = {
  movement: { STA: 3, AP: (AGI: number) => Math.floor(AGI / 2), earmarked: true, allows: ['movement', 'reactions'], restriction: 'Only in your own turn, or as a flee. A push or a drag is not movement here. Running costs no STA for the rest of the turn.' },
  combat:   { STA: 3, AP: () => 4, earmarked: true, allows: ['attacks', 'movement', 'grapple', 'defenses', 'reflexes'], restriction: 'Only in your own turn. Not while afraid.', forbiddenBy: 'afraid' },
  reaction: { STA: 3, AP: () => 4, earmarked: false, restriction: 'No turn can be started this round. Not while enraged.', forbiddenBy: 'enraged' },
  focus:    { STA: 0, AP: () => 0, earmarked: false, restriction: 'Required for shooting weapons, spells and use items from containers.' },
} as const satisfies Record<string, { STA: number; AP: (AGI: number) => number; earmarked: boolean; allows?: readonly SurgeAllowance[]; restriction: string; forbiddenBy?: keyof typeof AFFLICTIONS }>

// combat.tex "Morale": "Combat morale DL = 0 + aggravating factors", and a
// test is triggered at the beginning of a round when they total MORALE_TRIGGER
// or more. `injured` is per injury penalty.
export const MORALE_AGGRAVATORS = { injured: 1, immobile: 3, grappled: 2, sensoryLimitation: 2, suffocating: 3, outOfSTA: 2 } as const
export const MORALE_TRIGGER = 3
// "Sensory limitation": total impairment within this many metres; "Out of
// STA": STA below this.
export const MORALE_SENSE_RADIUS = 10
export const MORALE_LOW_STA = 3

// combat.tex "Social actions": intimidation, taunt and rally, each moving the
// target's morale DL by 1 + charisma/2 (`bonus` + half the charisma, floored).
export const SOCIAL_BONUS = 1

// What weighs on a morale test from what was said: the three social actions,
// and creating.tex "Limit Stress Actions" (abusive): the insult "increas[es]
// the morale test DL by +1 for the team".
export const PRESSURE_KINDS = ['intimidate', 'taunt', 'rally', 'insult'] as const
export const INSULT_BONUS = 1

// spells.tex, the Animancy spells whose test is a morale test (combat.tex
// "Morale"). `reach`: the one aimed at, within `range` metres, or everyone
// within the caster's active synesthesia or under their telepathic link (the
// table's ruling: the cast range printed for those is not theirs). `taunt`
// leaves the target enraged instead of afraid; `compels` is the limit stress
// action a miss activates in place of the target's own ('suggested': the one
// the caster picked), `constraint` what it binds it to; `pacify` is a test the
// target remakes to be rid of fear and anger, and activates nothing.
export type MoraleSpell = {
  reach: 'target' | 'minds'
  range: number | null
  taunt: boolean
  compels: LimitStressAction | 'suggested' | null
  constraint: 'attack' | 'flee' | null
  pacify: boolean
}
const SINGLE = { reach: 'target', range: 15, taunt: false, compels: null, constraint: null, pacify: false } as const
export const MORALE_SPELLS: Partial<Record<SpellKey, MoraleSpell>> = {
  frighten: SINGLE,
  offend: { ...SINGLE, taunt: true },
  pacify: { ...SINGLE, pacify: true },
  suggestion: { ...SINGLE, compels: 'suggested' },
  'overwhelming-terror': { reach: 'minds', range: null, taunt: false, compels: 'coward', constraint: 'flee', pacify: false },
  'provocative-mockery': { reach: 'minds', range: null, taunt: true, compels: 'violent', constraint: 'attack', pacify: false },
}

// spells.tex "Spiritual Strike": a blow to the spirit, whoever launches it.
// The target tests SPI + `SM`xSM against the attacker's SPI + `SM`xSM; the
// blow is what their miss lands in full (`hit`) and their graze at half
// (the table's ruling: stunned and 2 STA, no STA "per 3 points under").
// abilities.tex "Spirit of Battle": `battleDL` more on the attacker's side
// (the table's ruling, in place of "uses will instead of animancy").
export const SPIRIT_ATTACK = {
  SM: 3,
  battleDL: 2,
  blows: {
    hit: { STA: 2, interruption: 'stunned' },
    graze: { STA: 1, interruption: 'interrupted' },
  },
} as const

// combat.tex "running": "The first 2 AP worth of running must be
// uninterrupted, otherwise, running cannot be started".
export const RUN_START_AP = 2

// combat.tex — the AP/STA price of each named action, in the book's own
// numbers. An attack variation is a delta on the weapon row's own AP
// ("Strike": "The AP cost is 3 AP, but that may be modified by attack
// variations"), so `quickShot` is negative and `reload` is 0: the row carries
// the base and the entry exists so an ability can move it. Everything else is
// the full price of a standalone action or reaction.
export const ACTION_COSTS = {
  // attack variations — combat.tex "Heavy Attack", "Sweeping Attack",
  // "Braced Attack", "Hook Attack" (its damage), "Assassinate" — those
  // three bought after a hit — "Snipe", "Quick Shot"; gear.tex "Reload"
  heavy1:    { AP: 1, STA: 0 },
  heavy2:    { AP: 2, STA: 1 },
  heavy3:    { AP: 3, STA: 1 },
  sweep:     { AP: 1, STA: 0 },
  braced:    { AP: 2, STA: 1 },
  hook:      { AP: 2, STA: 1 },
  assassinate: { AP: 1, STA: 0 },
  snipe:     { AP: 2, STA: 0 },
  quickShot: { AP: -1, STA: 0 },
  reload:    { AP: 0, STA: 0 },
  // melee defenses — combat.tex "Defend"
  evade:       { AP: 2, STA: 0 },
  evasiveJump: { AP: 3, STA: 1 },
  block:       { AP: 2, STA: 0 },
  intercept:   { AP: 3, STA: 0 },
  // combat.tex "Crash": "The target can spend 2AP+1STA to get +3 in this
  // comparison"
  brace:       { AP: 2, STA: 1 },
  // abilities.tex "Defender": "spend 1 STA to move 1 basic movement";
  // "Defensive Advance": "Spend 1 STA to move forward" — on top of the
  // defense they are taken for
  defenderStep:     { AP: 0, STA: 1 },
  defensiveAdvance: { AP: 0, STA: 1 },
  // ranged reactions — combat.tex "Reflex"
  reflex:         { AP: 3, STA: 0 },
  guard:          { AP: 2, STA: 0 },
  avoidExplosion: { AP: 3, STA: 0 },
  // combat.tex "Explosion Block" names no price: the table's ruling, a guard's
  blockExplosion: { AP: 2, STA: 0 },
  // grappling — combat.tex "Grapple"
  grappleManeuver: { AP: 3, STA: 1 },
  grappleDefense:  { AP: 2, STA: 1 },
  catch:           { AP: 3, STA: 1 },
  // combat.tex "Push and drag": "spend 2 AP to gain 5 force in one
  // comparison"
  pushBoost:       { AP: 2, STA: 0 },
  // everything else — combat.tex "Rest", "Preparing a reaction", "Analyze",
  // "Standard Action", "Flanking", "Social actions"
  rest:           { AP: 4, STA: 0 },
  // combat.tex "Fire": "Both muffling and throwing water require 4 AP by default"
  extinguish:     { AP: 4, STA: 0 },
  prepare:        { AP: 1, STA: 0 },
  analyze:        { AP: 4, STA: 1 },
  standardAction: { AP: 3, STA: 0 },
  // gear.tex "Donning and Doffing armor": "8 AP to doff non rigid armor"
  doffArmor:      { AP: 8, STA: 0 },
  switchFocus:    { AP: 1, STA: 0 },
  socialAction:   { AP: 5, STA: 0 },
} as const satisfies Record<string, { AP: number; STA: number }>

export type ActionKind = keyof typeof ACTION_COSTS

// combat.tex "Grapple": "Any skill test made by several characters uses the
// highest skill value among them plus 3/2/1 for each additional character,
// up to a maximum of 5. ... Characters with force 5 points lower than their
// opponent always add just +1." The bonus of the second, third and every
// further helper, and what one that far weaker adds.
export const ASSIST = { bonus: [3, 2, 1], max: 5, weaker: 1, weakerBy: 5 } as const

// combat.tex "Shoot", "Quick Shot", "Snipe": the ways a shooting weapon is
// fired, each named by the variation the attack list gives it and the penalty
// it takes for every step of distance between shooter and target before the shooter's
// abilities move it.
export const SHOTS = {
  shoot:     { variant: 'basic', distance: 2 },
  quickShot: { variant: 'quick', distance: 3 },
  snipe:     { variant: 'snipe', distance: 1 },
} as const satisfies Record<string, { variant: string; distance: number }>

// combat.tex "Distance penalty": "a penalty of -2 per 20m of distance [...].
// Everything under 10m has no penalty" — a step at 10m, 30m, 50m; "Ranged
// attacks outside the combat area": "3x the shot's distance penalty", which
// is where the penalty stops growing.
export const DISTANCE_FREE = 10
export const DISTANCE_STEP = 20
export const DISTANCE_PENALTY_CAP_STEPS = 3

export type ShotKind = keyof typeof SHOTS

// combat.tex "Approach": the distance tiers a shooting weapon's range names,
// as the far edge of each in metres — "Shooting: ... around 50m to 200m",
// "Far: ... around 200m to 500m".
export const SHOT_RANGE_METRES: Record<(typeof SHOT_RANGES)[number], number> = {
  shooting: 200,
  far: 500,
}

// gear.tex "Ranged Weapons", abilities.tex "Archer": the bows, the shooting
// weapons that "require training to be used effectively" — the Archer
// ability. Crossbows and arbalests are not among them.
export const BOWS = ['Short Bow', 'Long Bow', 'Heavy Bow'] as const

// combat.tex "What cuts?": "There are 4 levels of material hardness. The first
// is for liquids. The second is for fabrics, flesh, and similar materials. The
// third is for wood, horns, bones and other solids. The fourth is for metals
// and rocks." A weapon cuts what is softer than it; gear.tex "Breakage and
// Hardness" adds that hardness 1 and 2 break nothing.
export const MATERIAL_HARDNESS: Record<(typeof MATERIALS)[number], number> = {
  metal: 4,
  rock: 4,
  wood: 3,
  bone: 3,
  flesh: 2,
  fiber: 2,
  liquid: 1,
}

// story.tex "Wealth and Money": "Ten coppers are worth the same as one
// silver, and 10 silvers are worth the same as 1 gold." Prices are kept in
// coppers; these are the coins a sum is written in and paid back in, largest
// first, each with the items catalog entry it is.
export const COINS = [
  { name: 'GP', value: 100, item: 'Gold Coin' },
  { name: 'SP', value: 10, item: 'Silver Coin' },
  { name: 'CP', value: 1, item: 'Copper Coin' },
] as const

// story.tex "Cost of Living": the daily cost (in coppers), exposure and
// renown of each living standard. "The cost of living changes from town to
// town. This table is an average." The book prints Miserable's and Poor's
// exposure as -3 and -1; the table's ruling reads them as +3 and +1, the
// rest exposure of survival.tex "Exposure".
export const COST_OF_LIVING: Record<LivingLevel, { cost: number; exposure: number; renown: number }> = {
  miserable: { cost: 1, exposure: 3, renown: 0 },
  poor: { cost: 5, exposure: 1, renown: 2 },
  medium: { cost: 10, exposure: 0, renown: 4 },
  rich: { cost: 30, exposure: 0, renown: 7 },
  lavish: { cost: 100, exposure: 0, renown: 10 },
}

// story.tex "Trainer": "Standard rates for training are given per level of
// training", in coppers per day, levels 1 to 5.
export const TRAINER_RATES = [4, 8, 20, 40, 100] as const

// creating.tex "Gaining Experience (XP)": "A regular training session for
// skills and proficiencies takes 10 days for 1 XP"; story.tex "Training":
// "10 x N" days.
export const DAYS_PER_XP = 10

// story.tex "Training without trainer": "miss = 0 XP, graze = N/4 XP, hit
// N/2 XP, crit N XP", as the share of N each degree yields.
export const SELF_TRAINING_YIELD: Record<Degree, number> = { miss: 0, graze: 0.25, hit: 0.5, critical: 1 }

// story.tex "Downtime", Healing: "Healer's heal rate x N in IL and wound.
// Payment is separate per IL and wound." The table's ruling for a normal
// doctor: 4 IL a day at 1 SP per IL, both changing with the healer's quality.
export const DOCTOR = { capacity: 4, price: 10 } as const

// creating.tex "Character Creation", Steps 3–7: what each priority gives a
// talent focus (its talent and XP to spend) and the wealth focus (gold).
export const CREATION_PRIORITIES: Record<Priority, { talent: number; XP: number; gold: number }> = {
  A: { talent: 2, XP: 60, gold: 100 },
  B: { talent: 1, XP: 42, gold: 60 },
  C: { talent: 1, XP: 30, gold: 30 },
  D: { talent: 0, XP: 24, gold: 10 },
  E: { talent: 0, XP: 16, gold: 5 },
}

// creating.tex "Character Creation", Step 4: "Characters start with 8 in all
// attributes".
export const CREATION_ATTRIBUTE = 8
