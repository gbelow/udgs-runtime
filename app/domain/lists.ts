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
