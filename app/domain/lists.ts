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

// abilities.tex "SPI" — the eight convictions, by name.
export const CONVICTIONS = {
  adaptation: { id: 'adaptation', name: 'Adaptation' },
  domination: { id: 'domination', name: 'Domination' },
  stoicism: { id: 'stoicism', name: 'Stoicism' },
  fatalism: { id: 'fatalism', name: 'Fatalism' },
  ferocity: { id: 'ferocity', name: 'Ferocity' },
  guardian: { id: 'guardian', name: 'Guardian' },
  hedonism: { id: 'hedonism', name: 'Hedonism' },
  providentialism: { id: 'providentialism', name: 'Providencialism' },
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
// properties cell, in the book's order, then the spellings its own tables add
// ("grab" on the Net row; "smash", defined among combat.tex's additional
// effects). One spelling per rule: the tables' "sweep" and "hooked" are the
// proplist's "sweeping" and "hook". "STR x" is parameterized, so it is the
// attack's own `STRreq` field rather than a member here.
export const WEAPON_PROPERTIES = [
  'grapple I',
  'grapple II',
  'sweeping',
  'braced',
  'shaft',
  'DEF',
  'hook',
  'heavy I',
  'heavy II',
  'heavy III',
  'heavy I-II',
  'heavy I-III',
  'heavy II-III',
  'piercing',
  'bladed',
  'penetrating',
  'precise',
  'vicious',
  'slow',
  'fast',
  'UF',
  'draw',
  'reload',
  'grab',
  'smash',
] as const

export const ATTACK_TYPES = ['melee', 'ranged'] as const

// gear.tex "One/Two hands".
export const HANDS = ['one', 'two'] as const

// gear.tex "Short, Long I/II": the reaches of a melee attack. Anything else
// in a Range column is a ranged attack, so the range alone says which an
// attack is; "9m" is the Net's own figure.
export const MELEE_RANGES = ['short', 'long I', 'long II'] as const
export const RANGED_RANGES = ['STR', '2xSTR', '9m', '100m', '150m', '200m'] as const
export const RANGES = [...MELEE_RANGES, ...RANGED_RANGES] as const
