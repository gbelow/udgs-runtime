// Inert enumerations: names and labels the UI renders as-is. Nothing here is a
// rule — no cost, threshold or modifier — which is why components may import
// this module directly while `tables.ts` is closed to them. A constant that
// gains a number belongs in `tables.ts`, behind a view getter.

// creating.tex "Areas of Knowledge" — the formal areas a character can train,
// in the rulebook's order. Commented-out entries there (Building, Politics,
// Botany, Physics) are deliberately absent. Any other knowledge is specific
// (story.tex "Specific Knowledge").
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
] as const

// creating.tex "Convictions" — "A character must adopt one worldview
// conviction and one temperament conviction"; which is which is the heading of
// each conviction in abilities.tex.
export const TEMPERAMENT_CONVICTIONS = {
  fatalism: { id: 'fatalism', name: 'Fatalism' },
  ferocity: { id: 'ferocity', name: 'Ferocity' },
  guardian: { id: 'guardian', name: 'Guardian' },
  hedonism: { id: 'hedonism', name: 'Hedonism' },
}

export const WORLDVIEW_CONVICTIONS = {
  adaptation: { id: 'adaptation', name: 'Adaptation' },
  domination: { id: 'domination', name: 'Domination' },
  stoicism: { id: 'stoicism', name: 'Stoicism' },
  providentialism: { id: 'providentialism', name: 'Providentialism' },
}

export const surgeKinds = ['movement', 'combat', 'reaction', 'focus'] as const

// abilities.tex — the subsections an ability is filed under, in the book's
// order. Groups the catalog in the sidebar and decides where a rendered entry
// lands in the chapter.
export const ABILITY_SECTIONS = [
  'CON',
  'Athletics',
  'Ranged Combat',
  'Melee Combat',
  'Adaptation',
  'Domination',
  'Stoicism',
  'Fatalism',
  'Ferocity',
  'Guardian',
  'Hedonism',
  'Providentialism',
  'Deities and Devotion',
  'Vices',
  'Traumas',
  'Linguistics',
  'Medicine',
  'Mechanics',
  'Chemistry',
  'Smithing',
  'Navigation',
  'Survival',
  'Animal Handling',
  'Cunning',
  'General',
  'Alchemy',
  'Animancy',
  'Biomancy',
  'Shamanism',
  'Physical Transfiguration',
  'Spiritual Mutation',
  'Chimerism',
] as const

// gear.tex "Containers and Burden" — the named bulks, indexed by the stored
// bulk; past these "the list goes on numerically".
export const BULK_NAMES = ['tiny', 'small', 'medium', 'large'] as const

// The smallest bulk a catalog item is made at: a coin, a hundred to a small
// slot (gear.tex "Coin Pouch").
export const MIN_BULK = -3

// gear.tex — the sections an item is filed under, in the book's order:
// "Weapons" (the arrows and bolts among them), "Armors", "Containers and
// Burden", then the "Tools of War" and "Special Items" subsections. Groups
// the item catalog and names the catalog a refId resolves in (weapons.json,
// ammo.json, armors.json, containers.json).
export const ITEM_TYPES = ['weapon', 'ammo', 'armor', 'container', 'flammable', 'poison', 'trap', 'magical', 'medicine', 'utility'] as const

// gear.tex "Special Items": what a flask can coat a space in. A coat burns
// when fire reaches it (combat.tex "Fire").
export const FUELS = ['oil', 'alcohol'] as const

// gear.tex "Quiver": "carries 20 arrows or bolts" — the two kinds of
// ammunition, each loaded by its own shooting weapons.
export const AMMO_KINDS = ['arrow', 'bolt'] as const

// gear.tex "Weapons Properties" — the vocabulary of an attack row's
// properties cell, in the book's order, then the spelling its own tables add. One spelling per
// rule: the tables' "sweep" and "hooked" are the proplist's "sweeping" and
// "hook". The parameterized entries are the attack's own fields rather than
// members here: "STR x" is `STRreq`, and "Heavy I/II/III" is `heavy`, a
// range of degrees.
export const WEAPON_PROPERTIES = [
  'grapple I',
  'grapple II',
  'sweeping',
  'braced',
  'shaft',
  'DEF',
  'hook',
  'piercing',
  'bladed',
  'penetrating',
  'precise',
  'slow',
  'fast',
  'UF',
  'draw',
  'reload',
  'explosion',
] as const

// gear.tex "Heavy I/II/III": the highest degree a heavy attack comes in.
export const HEAVY_MAX_DEGREE = 3

// gear.tex "Armors" and "Characteristics and Conditions" — what an armor can
// be beyond its numbers: the table's own grouping ("Rigid armors"), then the
// characteristics and conditions an armor can carry, in the book's order. Its
// material is not among these: "Fiber" and "Metallic" are the armor's
// `material`.
// gear.tex "Gear condition": what a blade's edge can be, beyond the usual.
export const EDGES = ['sharp', 'dull'] as const

export const ARMOR_PROPERTIES = [
  'rigid',
  'pitted',
  'misfitted',
  'flammable',
  'reflective',
  'insulating',
  'noisy',
  'air filter',
  'magnetic',
] as const

// What a piece of gear is made of, as combat.tex "What cuts?" names them;
// its hardness is in `tables.ts`. gear.tex "Weapons Properties": "All weapon
// attacks are made out of metal, unless otherwise stated."
export const MATERIALS = ['metal', 'rock', 'wood', 'bone', 'flesh', 'fiber', 'liquid'] as const

export const ATTACK_TYPES = ['melee', 'ranged'] as const

// combat.tex "Localized damage": the kinds of place a body part can be — the
// humanoid's four, in the book's order ("Each type of creature may have places
// that can specifically be aimed at"), and `other` for whatever else a
// creature has. The kind is what the rest of the rules read a part as (a hand
// grips, legs hold it up); what aiming at it does is on the part itself, with
// the humanoid's in `tables.ts` PART_PRESETS.
export const HUMANOID_LOCATIONS = ['chest', 'hand', 'leg', 'head'] as const
export const HIT_LOCATIONS = [...HUMANOID_LOCATIONS, 'other'] as const

// What a body part does beyond its wounds, a flag at a time.
// combat.tex "Head": "Getting stunned in the head causes unconsciousness";
// "Hand": "Hands have no armor unless the character is wearing gauntlets";
// "Head": "Bypass at the head hits flesh, which ignores all armor" — unless a
// closed visor is down (gear.tex "Closed helmet").
export const PART_FLAGS = ['stunUnconscious', 'bareWithoutGauntlets', 'bypassToFlesh'] as const

// combat.tex "Wounds": what a wound does to the part it is on — puts it out
// of use until healed, cuts it off, or kills.
export const WOUND_EFFECTS = ['disable', 'sever', 'kill'] as const

// combat.tex "Success Overflow" and the hand switch of "Localized damage":
// what HOP can buy, in the book's order; prices and gates are in `tables.ts`.
export const HOP_PURCHASES = ['slice', 'bypass', 'bust', 'smash', 'handSwitch', 'assassinate', 'braced', 'hook'] as const

// gear.tex "One/Two hands".
export const HANDS = ['one', 'two'] as const

// combat.tex "Movement": the ways a character crosses the grid under its own
// power, in the order of the "Movement Costs and Speeds" table. Standing up
// is there too but moves nobody, and mounted movement is the mount's.
// Climbing is the skill's ("Climbing": "The climbing speed is equal to the
// crawling speed but costs 1 AP + 1 STA"), the way over a cliff.
export const MOVEMENT_KINDS = ['careful', 'basic', 'run', 'jump', 'crawl', 'climb', 'swim'] as const
// combat.tex "Push and drag": the speeds a grapple moves at
export const PUSH_MOVEMENTS = ['careful', 'basic', 'run'] as const

// combat.tex "Movement": "Stand up: Removes the prone condition", priced in
// the same table ("Stand up"); and going prone, which the table leaves free.
// Moves that change posture and cross no cells.
export const POSTURES = ['stand', 'prone'] as const

// combat.tex "Grapple Maneuvers": "escape, immobilize, disarm, or knock down".
export const GRAPPLE_MANEUVERS = ['escape', 'immobilize', 'disarm', 'knockdown'] as const

// combat.tex "Defend": "There are four types of defense: Evade, Evasive
// Jump, Intercept, and Block."
export const DEFENSES = ['evade', 'evasiveJump', 'block', 'intercept'] as const

// The afflictions a grapple puts on and takes off: "grappled", and what the
// immobilize and knockdown maneuvers leave.
export const GRAPPLE_AFFLICTIONS = ['grappled', 'immobile'] as const

// What the simulated board's terrain can be painted with: the cell flags of
// combat.tex "Positioning and Visibility" and "Balance", one at a time.
export const TERRAIN_BRUSHES = ['wall', 'glass', 'sturdier', 'flimsier', 'water', 'rough', 'soft', 'raise', 'lower', 'deepen', 'shoal', 'harder', 'easier', 'grip', 'slip', 'bare', 'dim', 'fog', 'dark', 'louder', 'quieter', 'clear'] as const

// combat.tex "Darkness and light": how much light the fight has where no
// light source reaches, brightest first.
export const LIGHT_LEVELS = ['bright', 'dim', 'dark'] as const

// gear.tex "Potions and Medicine": what a potion gives whoever drinks it, for
// the rest of the fight.
export const POTIONS = ['darkseeing'] as const

// survival.tex "Exploration": "Exploration Action: are Traveling, Searching,
// Preparing"
export const EXPLORATION_ACTIONS = ['travel', 'search', 'prepare'] as const
export type ExplorationAction = (typeof EXPLORATION_ACTIONS)[number]

// The tests a character makes once for a round and scores against every DL
// the round puts to them, in the order the rulebook introduces them.
export const HELD_TESTS = ['swim', 'climb', 'balance', 'stealth'] as const

// The held tests the beginning of a round calls for; the rest are first made
// as the die of the move that needs them.
export const CALLED_TESTS = ['swim', 'stealth'] as const satisfies readonly (typeof HELD_TESTS)[number][]

// creating.tex "Size and Space Occupation": "Other creatures may have
// different shapes." The shapes a footprint can be started from; the cells
// each one covers at each size are in `tables.ts`.
export const FOOTPRINT_PRESETS = ['blob', 'line'] as const
export type FootprintPreset = (typeof FOOTPRINT_PRESETS)[number]

// gear.tex "Short, Long I/II": the reaches of a melee attack. Anything else
// in a Range column is a ranged attack, and combat.tex "Throw"/"Shoot" split
// those in two: a throw carries a figure of its own ("5m", "10m", "30m"), a shot
// a distance tier (combat.tex "Approach": Shooting, Far). The range alone
// says which kind an attack is.
export const MELEE_RANGES = ['short', 'long I', 'long II'] as const
export const THROWN_RANGES = ['5m', '10m', '30m'] as const
export const SHOT_RANGES = ['shooting', 'far'] as const
export const RANGES = [...MELEE_RANGES, ...THROWN_RANGES, ...SHOT_RANGES] as const

// combat.tex "Chases": "There are four distance tiers: Combat, Shooting, Far
// and Horizon", nearest first.
export const CHASE_TIERS = ['combat', 'shooting', 'far', 'horizon'] as const
export type ChaseTier = (typeof CHASE_TIERS)[number]
// The two teams of a chase: the one that ran away first, and the one that
// gave chase. Who chases whom is a matter of each link, not of the team
// (combat.tex "Inverting chase").
export const CHASE_SIDES = ['quarry', 'pursuers'] as const
export type ChaseSide = (typeof CHASE_SIDES)[number]
// The two ends of a link in the chain (combat.tex "Group chases").
export const CHASE_ROLES = ['chaser', 'chased'] as const
export type ChaseRole = (typeof CHASE_ROLES)[number]
// combat.tex "Chase actions": "Chase actions can be running, skirmish, [...]
// or hiding" — running as the party's role goes (a chaser at whoever it
// chases, the chased away from its chasers) or the other way ("Running can be
// in the direction of the pursuer or away from them").
export const CHASE_MOVES = ['run', 'reverse', 'shoot', 'hide'] as const
export type ChaseMove = (typeof CHASE_MOVES)[number]
// combat.tex "Running": "the fastest decides to close the distance or move
// away".
export const CHASE_WAYS = ['close', 'open'] as const
export type ChaseWay = (typeof CHASE_WAYS)[number]
// combat.tex "Hiding and Terrain": "a balance, climb or swim test to
// determine the ability to traverse".
export const CROSSING_SKILLS = ['balance', 'climb', 'swim'] as const
export type CrossingSkill = (typeof CROSSING_SKILLS)[number]
// combat.tex "Skirmish", "Cover": staying in cover, untargetable, or
// leaving it to shoot or move, partly covered.
export const CHASE_COVERS = ['total', 'partial'] as const
export type ChaseCover = (typeof CHASE_COVERS)[number]

// creating.tex "Limit Stress Actions": "Each character must choose a limit
// stress action", the one a failed morale test activates.
export const LIMIT_STRESS_ACTIONS = ['coward', 'violent', 'tanatosis', 'abusive', 'traitor', 'martyr'] as const
export type LimitStressAction = (typeof LIMIT_STRESS_ACTIONS)[number]

// story.tex "Cost of Living": the living standards, poorest first.
export const LIVING_LEVELS = ['miserable', 'poor', 'medium', 'rich', 'lavish'] as const
export type LivingLevel = (typeof LIVING_LEVELS)[number]
