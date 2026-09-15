import { z } from 'zod'
import { AbilityFamilySchema, ArmorSchema, ContainerSchema, ItemSchema, SpellSchema, WeaponSchema } from '../domain/types'
import { slug } from '../domain/utils'
import abilities from '../assets/abilities.json'
import spells from '../assets/spells.json'
import weapons from '../assets/weapons.json'
import armors from '../assets/armors.json'
import items from '../assets/items.json'
import containers from '../assets/containers.json'

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
  groupOf: (entry: Record<string, unknown>) => string
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
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: () => '',
  },
  armors: {
    label: 'Armors', file: 'armors.json', schema: ArmorSchema, data: armors,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: () => '',
  },
  items: {
    label: 'Items', file: 'items.json', schema: ItemSchema, data: items,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'type'),
  },
  containers: {
    label: 'Containers', file: 'containers.json', schema: ContainerSchema, data: containers,
    keyOf: (e) => text(e, 'name'), nameOf: (e) => text(e, 'name'), groupOf: (e) => text(e, 'kind'),
  },
} satisfies Record<string, CatalogSpec>

export type CatalogName = keyof typeof CATALOGS
export const CATALOG_NAMES = Object.keys(CATALOGS) as CatalogName[]

export function isCatalogName(name: string): name is CatalogName {
  return name in CATALOGS
}
