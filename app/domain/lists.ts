// Inert enumerations: names and labels the UI renders as-is. Nothing here is a
// rule — no cost, threshold or modifier — which is why components may import
// this module directly while `tables.ts` is closed to them. A constant that
// gains a number belongs in `tables.ts`, behind a view getter.

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

// gear.tex — the sections an item is filed under, in the book's order:
// "Weapons", "Armors", then the "Tools of War" and "Special Items"
// subsections. Groups the item catalog and names the catalog a refId
// resolves in (weapons.json, armors.json).
export const ITEM_TYPES = ['weapon', 'armor', 'flammable', 'poison', 'trap', 'magical', 'medicine', 'utility'] as const

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
] as const

// gear.tex "Heavy I/II/III": the highest degree a heavy attack comes in.
export const HEAVY_MAX_DEGREE = 3

// gear.tex "Armors" and "Characteristics and Conditions" — what an armor can
// be beyond its numbers: the table's own grouping ("Rigid armors"), then the
// characteristics and conditions an armor can carry, in the book's order. Its
// material is not among these: "Fiber" and "Metallic" are the armor's
// `material`.
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

// combat.tex "Localized damage": the places a humanoid can be aimed at, in the
// book's order; what aiming at each does is in `tables.ts` LOCATIONS.
export const HIT_LOCATIONS = ['chest', 'hand', 'leg', 'head'] as const

// combat.tex "Success Overflow" and the hand switch of "Localized damage":
// what HOP can buy, in the book's order; prices and gates are in `tables.ts`.
export const HOP_PURCHASES = ['extraCut', 'bypass', 'penetrating', 'smash', 'handSwitch'] as const

// gear.tex "One/Two hands".
export const HANDS = ['one', 'two'] as const

// combat.tex "Movement": the ways a character crosses the grid under its own
// power, in the order of the "Movement Costs and Speeds" table. Standing up
// is there too but moves nobody, and mounted movement is the mount's.
export const MOVEMENT_KINDS = ['careful', 'basic', 'run', 'jump', 'crawl', 'swim'] as const

// creating.tex "Size and Space Occupation": "Other creatures may have
// different shapes." The shapes a footprint can take; the cells each one
// covers at each size are in `tables.ts`.
export const SHAPES = ['blob', 'line'] as const

// gear.tex "Short, Long I/II": the reaches of a melee attack. Anything else
// in a Range column is a ranged attack, and combat.tex "Throw"/"Shoot" split
// those in two: a throw's range comes from STR ("9m" is the Net's own figure,
// and the Net is thrown), a shot's is the weapon's. The range alone says
// which kind an attack is.
export const MELEE_RANGES = ['short', 'long I', 'long II'] as const
export const THROWN_RANGES = ['STR', '2xSTR', '9m'] as const
export const SHOT_RANGES = ['100m', '150m', '200m'] as const
export const RANGES = [...MELEE_RANGES, ...THROWN_RANGES, ...SHOT_RANGES] as const
