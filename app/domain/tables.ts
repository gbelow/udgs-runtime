import { MATERIALS } from './lists'

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
// `supersedes` names a ladder this affliction replaces outright while it is
// on: the ladder's rungs drop out of the derived set instead of stacking.
//
// `controlable` is whether the affliction can be toggled by hand. The rungs
// that survival.tex derives from hunger, thirst and exhaustion are not: they
// are owned by their resource and clicking them does nothing.
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
  prone: { controlable: true, category: "mobility" },
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
// spells" converts every point above a hit into an SOP. Reaching n SOPs on
// a cast therefore means beating DL + HIT_MARGIN + n.
export const HIT_MARGIN = 5

// spells.tex "Types of Spells and Modifications" — what each improvement
// costs in SOPs, chosen after the roll. Quicken is not here: it is decided
// before the roll and moves the DL instead (QUICKEN_DL).
export const SPELL_MODIFICATIONS = {
  extend:     { SOP: 3, text: 'casting range +100%, then +200%, +300%, ...' },
  enhance:    { SOP: 4, text: 'the special improvement described in the spell' },
  amplify:    { SOP: 4, text: 'multiply an effect marked DM, SM, RM or VM once more' },
  effortless: { SOP: 6, text: 'rest while casting; halves the exhaustion cost out of combat' },
} as const satisfies Record<string, { SOP: number; text: string }>

// "Quicken Spell: Increases spell DL by 4 to allow it to be cast during any
// surge and not cause opportunity attacks."
export const QUICKEN_DL = 4

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
  // "Braced Attack", "Hook Attack" (the trip rider, bought after a hit),
  // "Snipe", "Quick Shot"; gear.tex "Reload"
  heavy1:    { AP: 1, STA: 0 },
  heavy2:    { AP: 2, STA: 1 },
  heavy3:    { AP: 3, STA: 1 },
  sweep:     { AP: 1, STA: 0 },
  braced:    { AP: 2, STA: 1 },
  hookTrip:  { AP: 1, STA: 1 },
  snipe:     { AP: 2, STA: 0 },
  quickShot: { AP: -1, STA: 0 },
  reload:    { AP: 0, STA: 0 },
  // melee defenses — combat.tex "Defend"
  evade:       { AP: 2, STA: 0 },
  evasiveJump: { AP: 2, STA: 1 },
  block:       { AP: 2, STA: 0 },
  intercept:   { AP: 3, STA: 0 },
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
