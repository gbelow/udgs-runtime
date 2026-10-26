import { z } from 'zod'
import { EventTemplateSchema, ScenePresetSchema, TerrainSchema, type CatalogKind } from '../domain/campaign/types'
import type { CatalogRow } from '../domain/campaign/projections/collections'
import { SurfaceSchema } from '../domain/scene/types'
import { AbilityFamilySchema, AmmoSchema, ArmorSchema, ContainerEntrySchema, ItemEntrySchema, SpecificKnowledgeEntrySchema, SpellSchema, WeaponSchema } from '../domain/types'
import { slug } from '../domain/utils'
import { getWeaponCategory } from '../domain/weaponProperties'
import { isSpecificKnowledgeName, knowledgeName } from '../domain/character/rules/knowledge'
import abilities from '../assets/abilities.json'
import spells from '../assets/spells.json'
import weapons from '../assets/weapons.json'
import armors from '../assets/armors.json'
import ammo from '../assets/ammo.json'
import items from '../assets/items.json'
import containers from '../assets/containers.json'
import terrains from '../assets/terrains.json'
import surfaces from '../assets/surfaces.json'
import events from '../assets/events.json'
import scenes from '../assets/scenes.json'
import knowledges from '../assets/knowledges.json'

// The editable catalogs: one JSON file under app/assets each, its schema,
// and how an entry is keyed and listed. The editor, the save action and the
// book renderer all read this table, so adding a catalog is one row.
export type CatalogSpec = {
  label: string
  file: string
  schema: z.ZodType
  data: Record<string, unknown>
  keyOf: (entry: Record<string, unknown>) => string // where a new entry is filed; an existing one keeps its key
  nameOf: (entry: Record<string, unknown>) => string
  groupOf?: (entry: Record<string, unknown>) => string // the category it is browsed under; none for a catalog without
  comparable?: 'collection' | 'category' // its panel shows its entries side by side as a table: any collection of them, or one category at a time
}

const text = (entry: Record<string, unknown>, field: string) => String(entry[field] ?? '')

export const CATALOGS = {
  abilities: {
    label: 'Abilities', file: 'abilities.json', schema: AbilityFamilySchema, data: abilities,
    keyOf: (e) => slug(text(e, 'family')), nameOf: (e) => text(e, 'family'), groupOf: (e) => text(e, 'section'),
  },
  spells: {
    label: 'Spells', file: 'spells.json', schema: SpellSchema, data: spells,
    keyOf: (e) => slug(text(e, 'name')), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'section'),
  },
  // gear is keyed by name: items point at their weapon or armor by it
  weapons: {
    label: 'Weapons', file: 'weapons.json', schema: WeaponSchema, data: weapons,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'),
    groupOf: (e) => { const weapon = WeaponSchema.safeParse(e); return weapon.success ? getWeaponCategory(weapon.data) : '' },
    comparable: 'category',
  },
  armors: {
    label: 'Armors', file: 'armors.json', schema: ArmorSchema, data: armors,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), comparable: 'collection',
  },
  ammo: {
    label: 'Ammunition', file: 'ammo.json', schema: AmmoSchema, data: ammo,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'kind'),
  },
  items: {
    label: 'Items', file: 'items.json', schema: ItemEntrySchema, data: items,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'type'),
  },
  containers: {
    label: 'Containers', file: 'containers.json', schema: ContainerEntrySchema, data: containers,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'kind'),
  },
  terrains: {
    label: 'Terrains', file: 'terrains.json', schema: TerrainSchema, data: terrains,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'),
  },
  surfaces: {
    label: 'Surfaces', file: 'surfaces.json', schema: SurfaceSchema, data: surfaces,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'),
  },
  // edited with the map's own event editor rather than the schema's form
  events: {
    label: 'Events', file: 'events.json', schema: EventTemplateSchema, data: events,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'),
  },
  scenes: {
    label: 'Scenes', file: 'scenes.json', schema: ScenePresetSchema, data: scenes,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'),
  },
  // keyed as a character holds it, so named as one can be
  knowledges: {
    label: 'Specific knowledges', file: 'knowledges.json', data: knowledges,
    schema: SpecificKnowledgeEntrySchema.refine((e) => isSpecificKnowledgeName(e.name), { message: "a specific knowledge needs a name that is not a formal knowledge's", path: ['name'] }),
    keyOf: (e) => knowledgeName(text(e, 'name')), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'kind'),
  },
} satisfies Partial<Record<CatalogKind, CatalogSpec>>

export type CatalogName = keyof typeof CATALOGS
export const CATALOG_NAMES = Object.keys(CATALOGS) as CatalogName[]

// Every entry of the catalog, keyed, named and filed under its category.
export function getCatalogRows(spec: CatalogSpec): CatalogRow[] {
  return Object.entries(spec.data).map(([key, entry]) => {
    const record = entry as Record<string, unknown>
    return { key, name: spec.nameOf(record), group: spec.groupOf?.(record) ?? '' }
  })
}

// The catalogs with editors of their own, which a collection lists too.
const OTHER_LABELS: Record<Exclude<CatalogKind, CatalogName>, string> = { characters: 'Characters', races: 'Races', maps: 'Maps' }

// What a catalog a collection lists is called.
export function getKindLabel(kind: CatalogKind): string {
  return isCatalogName(kind) ? CATALOGS[kind].label : OTHER_LABELS[kind]
}

export function isCatalogName(name: string): name is CatalogName {
  return name in CATALOGS
}
