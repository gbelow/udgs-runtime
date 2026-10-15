import { CollectionSchema, type CatalogKind, type Collection } from '../types'
import { toggled } from '../../utils'

export type CollectionUpdater = (c: Collection) => Collection

// A new list of `kind`'s entries for `owner`, unnamed, with none in it yet
// and shared with nobody.
export function newCollection(id: string, owner: string, kind: CatalogKind): Collection {
  return CollectionSchema.parse({ id, owner, kind })
}

export function renameCollection(name: string): CollectionUpdater {
  return (c) => ({ ...c, name })
}

// Puts the entry filed under `key` in the list, or takes it out.
export function setInCollection(key: string, on: boolean): CollectionUpdater {
  return (c) => (c.keys.includes(key) === on ? c : { ...c, keys: [...toggled(c.keys, key, on)] })
}

// Shares the list with a profile or with every member of a campaign, or
// stops sharing it.
export function shareCollection(to: 'profiles' | 'campaigns', id: string, on: boolean): CollectionUpdater {
  return (c) => (c.shared[to].includes(id) === on ? c : { ...c, shared: { ...c.shared, [to]: [...toggled(c.shared[to], id, on)] } })
}
