import type { CatalogKind, Collection } from '../types'
import { groupBy } from '../../utils'

// An entry of a catalog as a collection sees it: the key it is filed under,
// its name, and the category it is browsed under ('' for none).
export type CatalogRow = { key: string; name: string; group: string }

// A catalog's entries, and what the catalog is called.
export type CatalogRows = { kind: CatalogKind; label: string; rows: CatalogRow[] }

// A collection a picker offers. One a GM made is `curated`, with its owner;
// the others are read off the catalogs themselves: all of them, each one
// whole, and each of their categories.
export type CollectionView = { id: string; name: string; keys: string[]; curated: boolean; owner: string | null }

export const ALL_ENTRIES = 'all'

// The collections a picker of the `catalogs`' entries offers: everything,
// the GM's own lists of those catalogs, each holding only the entries its
// catalog still has, then each catalog whole where there are several, and
// each category. Where there are several catalogs, a name says whose.
export function getCollections(collections: readonly Collection[], catalogs: CatalogRows[]): CollectionView[] {
  const several = catalogs.length > 1
  const named = (label: string, name: string) => (several ? `${label}: ${name}` : name)
  const derived = (id: string, name: string, rows: CatalogRow[]): CollectionView => ({ id, name, keys: rows.map((r) => r.key), curated: false, owner: null })
  return [
    derived(ALL_ENTRIES, 'everything', catalogs.flatMap((c) => c.rows)),
    ...catalogs.flatMap(({ kind, label, rows }) => {
      const keys = new Set(rows.map((r) => r.key))
      return collections
        .filter((c) => c.kind === kind)
        .map((c) => ({ id: c.id, name: named(label, c.name), keys: c.keys.filter((k) => keys.has(k)), curated: true, owner: c.owner }))
    }),
    ...(several ? catalogs.map((c) => derived(c.kind, c.label, c.rows)) : []),
    ...catalogs.flatMap(({ kind, label, rows }) => [...new Set(rows.map((r) => r.group).filter((g) => g !== ''))].sort()
      .map((group) => derived(`${kind}/${group}`, named(label, group), rows.filter((r) => r.group === group)))),
  ]
}

// A catalog's entries by category, or in one list without a header where
// none has a category.
export function getCatalogGroups(rows: CatalogRow[]): { label: string | null; rows: CatalogRow[] }[] {
  return rows.some((r) => r.group !== '') ? groupBy(rows, (r) => r.group) : [{ label: null, rows }]
}
