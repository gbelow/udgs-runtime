import { HIT_LOCATIONS, HOP_PURCHASES, MATERIALS, SHOT_RANGES } from './lists'
import type { AfflictionKey, MeleeRange, MovementKind, Shape, WeaponProperty } from './types'
import type { Coord } from './combat/types'

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
// creating.tex "Reach Multiplier (RM)": multiplies the range of all weapons.
export const RMArr = [0.5, 1, 1, 1.5, 1.5, 2, 2.5]

// creating.tex "Size and Space Occupation": "A creature of size 3 in human
// form occupies 1 ... hexagon. For every 2 size categories ... a hexagonal
// grid will occupy 3 spaces ..., then 7." Indexed by size - 1; the sizes
// between two steps keep the lower step's count.
export const FOOTPRINT_CELLS = [1, 1, 1, 1, 3, 3, 7] as const
export type FootprintCells = (typeof FOOTPRINT_CELLS)[number]

// The cells each shape covers at each count, as offsets from the anchor
// cell in orientation 0 (facing `geometry.ts` direction 0); the placement's
// orientation turns them. The 3-cell blob is the book's token "in the middle
// of 3"; a line is a creature that is long rather than wide.
export const FOOTPRINTS: Record<Shape, Record<FootprintCells, readonly Coord[]>> = {
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

// combat.tex "Movement Costs and Speeds": what one block of each movement
// costs; how far a block goes is the character's speed for it (the
// `movement` lenses), so the table here is only the price column. Running
// "can run a partial amount smaller than its running speed, but AP cost is
// the same", and a jump cannot be interrupted, so both are bought whole.
export const MOVEMENT_BLOCK_COST: Record<MovementKind, { AP: number; STA: number }> = {
  careful: { AP: 1, STA: 0 },
  basic:   { AP: 1, STA: 0 },
  run:     { AP: 2, STA: 0 },
  jump:    { AP: 2, STA: 1 },
  crawl:   { AP: 1, STA: 0 },
  swim:    { AP: 1, STA: 0 },
}

// gear.tex "Short, Long I/II": "Short-range attacks ... have a range of 1m x
// RM. Long-range attacks have an extended range of 1m x RM per level." The
// metres before the RM.
export const REACH: Record<MeleeRange, number> = {
  short: 1,
  'long I': 2,
  'long II': 3,
}

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

// combat.tex "Wounds" table. A wound is a permanent effect the character
// carries in `active` until healed: `heal` is the IL wound to heal it away
// (null for "no heal" — an amputation is for good), `affliction` its
// consequence on the sheet, `tier` the lowest tier at the location that
// causes it. Shocked alone needs the blunt type and a smash. A hand's
// consequence is carried by the hand itself (hands.ts), not by an affliction.
export const WOUNDS = {
  brokenHand:    { name: 'broken hand',    location: 'hand',  tier: 2, heal: 10,   affliction: null,       amputation: false, smash: false },
  amputatedHand: { name: 'amputated hand', location: 'hand',  tier: 4, heal: null, affliction: null,       amputation: true,  smash: false },
  brokenLeg:     { name: 'broken leg',     location: 'leg',   tier: 3, heal: 20,   affliction: 'lame',     amputation: false, smash: false },
  amputatedLeg:  { name: 'amputated leg',  location: 'leg',   tier: 5, heal: null, affliction: 'lame',     amputation: true,  smash: false },
  shocked:       { name: 'shocked',        location: 'chest', tier: 3, heal: 5,    affliction: 'immobile', amputation: false, smash: true },
} as const satisfies Record<string, { name: string; location: (typeof HIT_LOCATIONS)[number]; tier: number; heal: number | null; affliction: AfflictionKey | null; amputation: boolean; smash: boolean }>
export type WoundKey = keyof typeof WOUNDS
// combat.tex "Head": "Getting stunned in the head causes unconsciousness";
// "Tier 4 damage causes instant death".
export const HEAD = { death: 4 } as const

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
// prone: it is taken and left by moving (combat.tex "Movement": "getting up:
// Removes the prone condition").
//
// `category` is the heading the affliction sits under on the sheet. It is a UI
// grouping, distinct from the penalty categories combat.tex names.
export type AfflictionCategory = 'mobility' | 'sensory' | 'damage' | 'mental' | 'health'

export type AfflictionDef = {
  sensory?: number
  mental?: number
  health?: number
  group?: string
  rank?: number
  supersedes?: string
  controlable: boolean
  category: AfflictionCategory
}

// Display order of the headings.
export const AFFLICTION_CATEGORIES: AfflictionCategory[] = ['mobility', 'sensory', 'damage', 'mental', 'health']

const AFFLICTION_DEFS = {
  lame: { controlable: true, category: "mobility" },
  prone: { controlable: false, category: "mobility" },
  grappled: { controlable: true, category: "mobility" },
  immobile: { controlable: true, category: "mobility" },

  disoriented: { sensory: 2, group: "disorient", controlable: true, category: "sensory" },
  oblivious: { sensory: 5, group: "disorient", controlable: true, category: "sensory" },
  blind: { controlable: true, category: "sensory" },
  deaf: { controlable: true, category: "sensory" },

  burning: { controlable: true, category: "damage" },
  corroding0: { group: 'corroding', rank: 1, controlable: true, category: "damage" },
  corroding1: { group: 'corroding', rank: 2, controlable: true, category: "damage" },

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
// costs in HOPs, chosen after the roll. Quicken is not here: it is decided
// before the roll and moves the DL instead (QUICKEN_DL).
export const SPELL_MODIFICATIONS = {
  extend:     { HOP: 3, text: 'casting range +100%, then +200%, +300%, ...' },
  enhance:    { HOP: 4, text: 'the special improvement described in the spell' },
  amplify:    { HOP: 5, text: 'multiply an effect marked DM, SM, RM or VM once more' },
  effortless: { HOP: 6, text: 'rest while casting; halves the exhaustion cost out of combat' },
} as const satisfies Record<string, { HOP: number; text: string }>

// "Quicken Spell: Increases spell DL by 4 to allow it to be cast during any
// surge and not cause opportunity attacks."
export const QUICKEN_DL = 3

// spells.tex "Casting spells": a graze in combat may "increase spell cost by
// 2 AP to gain +3 once in the test".
export const GRAZE_SAVE = { AP: 2, bonus: 3 } as const

export type SpellModification = keyof typeof SPELL_MODIFICATIONS

// combat.tex "Action surge" — one surge per round. Each kind prices its AP
// in STA; the movement surge alone scales its yield with AGI, so the yield
// column is a function of AGI rather than a number. The spending restriction
// is recorded as prose for the UI. `forbiddenBy` is the affliction under which
// the surge cannot be made voluntarily (combat.tex "Afflictions": afraid bars
// the combat surge, enraged the reaction surge).
export const SURGES = {
  movement: { STA: 3, AP: (AGI: number) => Math.floor(AGI / 2), restriction: 'AP must be spent on movement immediately; allows running until the end of the turn.' },
  combat:   { STA: 3, AP: () => 4, restriction: 'AP must be spent immediately on attacks or movement. Not while afraid.', forbiddenBy: 'afraid' },
  reaction: { STA: 3, AP: () => 4, restriction: 'AP can only be spent on reactions until the end of the round. Not while enraged.', forbiddenBy: 'enraged' },
  focus:    { STA: 0, AP: () => 0, restriction: 'AP is free to use. Required for shooting weapons, spells and use items from containers.' },
} as const satisfies Record<string, { STA: number; AP: (AGI: number) => number; restriction: string; forbiddenBy?: keyof typeof AFFLICTIONS }>

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
  // abilities.tex "Defender": "spend 1 STA to move 1 basic movement";
  // "Defensive Advance": "Spend 1 STA to move forward" — on top of the
  // defense they are taken for
  defenderStep:     { AP: 0, STA: 1 },
  defensiveAdvance: { AP: 0, STA: 1 },
  // ranged reactions — combat.tex "Reflex"
  reflex:         { AP: 2, STA: 0 },
  guard:          { AP: 2, STA: 0 },
  avoidExplosion: { AP: 3, STA: 0 },
  // grappling — combat.tex "Grapple"
  grappleManeuver: { AP: 3, STA: 1 },
  grappleDefense:  { AP: 2, STA: 1 },
  catch:           { AP: 3, STA: 1 },
  pushDrag:        { AP: 2, STA: 1 },
  // everything else — combat.tex "Rest", "Preparing a reaction", "Analyze",
  // "Standard Action", "Flanking", "Social actions"
  rest:           { AP: 4, STA: 0 },
  prepare:        { AP: 1, STA: 0 },
  analyze:        { AP: 4, STA: 1 },
  standardAction: { AP: 3, STA: 0 },
  // gear.tex "Donning and Doffing armor": "6 AP to don/doff medium armors"
  donMedium:      { AP: 6, STA: 0 },
  switchFocus:    { AP: 1, STA: 0 },
  socialAction:   { AP: 4, STA: 1 },
} as const satisfies Record<string, { AP: number; STA: number }>

export type ActionKind = keyof typeof ACTION_COSTS

// combat.tex "Grapple": "Any skill test made by several characters uses the
// highest skill value among them plus 3/2/1 for each additional character,
// up to a maximum of 5. ... Characters of a smaller size category add a
// maximum of 2." The bonus of the second, third and every further helper.
export const ASSIST = { bonus: [3, 2, 1], max: 5, smallerMax: 2 } as const

// combat.tex "Shoot", "Quick Shot", "Snipe": the ways a shooting weapon is
// fired, each named by the variation the attack list gives it and how far it
// reaches in metres before the shooter's abilities move it — null is as far
// as the weapon itself. "Quick Shot ... can only be used within 10m of the
// target"; "Shoot is only allowed against targets within 30m"; Snipe "allows
// shooting targets at any distance".
export const SHOTS = {
  shoot:     { variant: 'basic', reach: 30 },
  quickShot: { variant: 'quick', reach: 10 },
  snipe:     { variant: 'snipe', reach: null },
} as const satisfies Record<string, { variant: string; reach: number | null }>

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

// combat.tex "Localized damage", the humanoid locations: the penalty to the
// attack test for aiming there, stored as a positive magnitude, and the
// highest injury tier the body takes from a hit there (`null` when the book
// sets no cap). Chest is the default when nothing is declared.
export const LOCATIONS = {
  chest: { penalty: 0, maxTier: null },
  hand:  { penalty: 10, maxTier: 2 },
  leg:   { penalty: 0, maxTier: 3 },
  head:  { penalty: 5, maxTier: null },
} as const satisfies Record<(typeof HIT_LOCATIONS)[number], { penalty: number; maxTier: number | null }>

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
