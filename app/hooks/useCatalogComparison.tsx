import { useMemo, useState } from 'react'
import { CATALOGS, CatalogName, CatalogSpec } from '../forms/catalogs'
import { getCategoryCollections } from '../domain/campaign/projections/collections'
import { getComparison, type ComparisonEntry, type ComparisonSort } from '../domain/campaign/projections/comparison'
import { useCollectionFilter } from './useCollections'

const BY_ENTRY: ComparisonSort = { column: null, descending: false }

// One catalog's entries in a collection (everything until another is
// chosen, or the first category where the catalog is compared by category),
// as a table in alphabetical order, sortable by a column: a press sorts by
// it, then reverses, then returns to the alphabet.
export function useCatalogComparison(catalog: CatalogName) {
  const filter = useCollectionFilter(catalog)
  const [sort, setSort] = useState<ComparisonSort>(BY_ENTRY)
  const spec: CatalogSpec = CATALOGS[catalog]
  const collections = useMemo(() => spec.comparable === 'category' ? getCategoryCollections(filter.collections, catalog) : filter.collections, [spec, filter.collections, catalog])
  const current = collections.find((c) => c.id === filter.chosen) ?? collections[0]
  const keys = current?.keys

  const table = useMemo(() => {
    const entries: ComparisonEntry[] = (keys ?? [])
      .filter((key) => key in spec.data)
      .map((key) => {
        const value = spec.data[key] as Record<string, unknown>
        return { key, name: spec.nameOf(value), value }
      })
    return getComparison(entries, sort)
  }, [keys, spec, sort])

  const sortBy = (column: string | null) => setSort((s) => {
    if (s.column !== column) return { column, descending: false }
    if (!s.descending) return { column, descending: true }
    return BY_ENTRY
  })

  return { collections, chosen: current?.id ?? '', choose: filter.choose, table, sort, sortBy } as const
}
