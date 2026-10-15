import { CollectionSchema, type CampaignUpdater, type CatalogKind, type Collection } from '../types'
import { without } from '../../utils'

function withCollection(id: string, change: (c: Collection) => Collection): CampaignUpdater {
  return (state) => {
    const collection = state.collections[id]
    return collection ? { ...state, collections: { ...state.collections, [id]: change(collection) } } : state
  }
}

// A new list of `kind`'s entries, unnamed, with none in it yet.
export function createCollection(id: string, kind: CatalogKind): CampaignUpdater {
  return (state) => (state.collections[id] ? state : { ...state, collections: { ...state.collections, [id]: CollectionSchema.parse({ kind }) } })
}

export function renameCollection(id: string, name: string): CampaignUpdater {
  return withCollection(id, (c) => ({ ...c, name }))
}

export function removeCollection(id: string): CampaignUpdater {
  return (state) => (state.collections[id] ? { ...state, collections: without(state.collections, id) } : state)
}

// Puts the entry filed under `key` in the list, or takes it out.
export function setInCollection(id: string, key: string, on: boolean): CampaignUpdater {
  return withCollection(id, (c) => (c.keys.includes(key) === on ? c : { ...c, keys: on ? [...c.keys, key] : c.keys.filter((k) => k !== key) }))
}
