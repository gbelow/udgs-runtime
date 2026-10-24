'use client'
import { useState } from 'react'
import { CATALOGS, CATALOG_NAMES, CatalogName } from '../../forms/catalogs'
import { useCatalogComparison } from '../../hooks/useCatalogComparison'
import { selectClass } from '../ui'

// One catalog's entries side by side: a collection of it (a list the GM made,
// the whole catalog or one category) as a table with a column for every field
// its entries set. A press on a heading sorts by that column.
export function CatalogCompare() {
  const [catalog, setCatalog] = useState<CatalogName>('weapons')
  return (
    <div className='flex flex-col gap-2 text-left'>
      <select aria-label='catalog' className={`${selectClass} self-start`} value={catalog} onChange={(e) => setCatalog(e.target.value as CatalogName)}>
        {CATALOG_NAMES.map((name) => <option key={name} value={name}>{CATALOGS[name].label}</option>)}
      </select>
      <ComparisonTable key={catalog} catalog={catalog} />
    </div>
  )
}

function ComparisonTable({ catalog }: { catalog: CatalogName }) {
  const { collections, chosen, choose, table, sort, sortBy } = useCatalogComparison(catalog)
  const th = 'px-2 pb-1 border-b border-line font-medium whitespace-nowrap text-left'
  return (
    <>
      <select aria-label='collection' className={`${selectClass} self-start`} value={chosen} onChange={(e) => choose(e.target.value)}>
        {collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.keys.length})</option>)}
      </select>
      <div className='max-h-[80vh] overflow-auto'>
        {table.rows.length === 0 ? <span className='text-sm text-muted'>Nothing in this collection.</span> : (
          <table className='text-xs'>
            <thead className='sticky top-0 bg-surface'>
              <tr>
                <th className={`${th} cursor-pointer select-none hover:text-accent`} onClick={() => sortBy(null)}>
                  entry{sort.column === null ? (sort.descending ? ' ▼' : ' ▲') : ''}
                </th>
                {table.columns.map((c) => (
                  <th key={c} className={`${th} cursor-pointer select-none hover:text-accent`} onClick={() => sortBy(c)}>
                    {c}{sort.column === c ? (sort.descending ? ' ▼' : ' ▲') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} className='border-b border-line/40 hover:bg-raised'>
                  <td className='px-2 py-0.5 whitespace-nowrap'>{r.entry}</td>
                  {r.cells.map((cell, i) => (
                    <td key={i} className={`px-2 py-0.5 ${cell.number !== null ? 'text-right font-mono' : ''}`}>{cell.text}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
