'use client'
import { ReactNode, useEffect, useRef } from 'react'
import type { useCatalogComparison } from '../../hooks/useCatalogComparison'
import type { ComparisonCell } from '../../domain/campaign/projections/comparison'
import { selectClass } from '../ui'

// One catalog's entries side by side: a collection of it (a list the GM made,
// the whole catalog or one category) as a table with a column for every field
// its entries set. A press on a heading sorts by that column, a press on an
// entry or any of its rows opens it, and the entry open is marked and kept
// in view. The rows of an entry's list (a weapon's attacks) sit under it,
// the first on the entry's own.
export function ComparisonTable({ comparison, selected, open, beside }: {
  comparison: ReturnType<typeof useCatalogComparison>, selected: string | null, open: (key: string) => void, beside?: ReactNode,
}) {
  const { collections, chosen, choose, table, sort, sortBy } = comparison
  const marked = useRef<HTMLTableSectionElement>(null)
  useEffect(() => { marked.current?.scrollIntoView({ block: 'nearest' }) }, [selected, chosen])
  const th = 'px-2 pb-1 border-b border-line font-medium whitespace-nowrap text-left'
  return (
    <>
      <div className='flex flex-row items-center gap-1'>
        <select aria-label='collection' className={selectClass} value={chosen} onChange={(e) => choose(e.target.value)}>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.keys.length})</option>)}
        </select>
        {beside}
      </div>
      <div className='min-h-0 overflow-auto'>
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
            {table.rows.map((r) => (
              <tbody key={r.id} ref={r.key === selected ? marked : undefined} onClick={() => open(r.key)}
                className={`border-b border-line cursor-pointer ${r.key === selected ? 'bg-accent/15 text-accent' : 'hover:bg-raised'}`}>
                <tr>
                  <td className='px-2 py-0.5 whitespace-nowrap font-medium'>{r.entry}</td>
                  {r.cells.map((cell, i) => <Cell key={i} cell={cell} />)}
                </tr>
                {r.children.map((child) => (
                  <tr key={child.id} className='border-t border-line/30'>
                    <td />
                    {child.cells.map((cell, i) => <Cell key={i} cell={cell} />)}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </>
  )
}

function Cell({ cell }: { cell: ComparisonCell }) {
  return <td className={`px-2 py-0.5 ${cell.number !== null ? 'text-right font-mono' : ''}`}>{cell.text}</td>
}
