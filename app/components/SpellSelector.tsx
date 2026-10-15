'use client'
import { useState, type ReactNode } from 'react'
import { Button, CatalogList } from './ui'
import { groupBy } from '../domain/utils'
import { useSpellLens } from '../hooks/useSpellLens'
import { useCollectionFilter } from '../hooks/useCollections'
import type { SpellCatalogRow } from '../domain/character/lenses/spells'
import { SpellMethodSchema } from '../domain/types'


// Browse the catalog one spell per row, grouped by school. A click unfolds
// the book's entry; the buttons learn it by one of the three methods, which
// decides the skill it is cast with.
export function SpellSelector({ wide = false }: { wide?: boolean }){
  const { catalog, learn } = useSpellLens()
  const filter = useCollectionFilter('spells')
  return(
    <CatalogList wide={wide} label='spell' groups={groupBy(catalog, (row) => row.section)} nameOf={(row) => row.name} collection={{ filter, keyOf: (row) => row.key }} render={(row) => (
      <SpellCatalogEntry key={row.key} row={row} action={
        row.learned ?
        <span className='text-xs text-muted px-1'>learned</span> :
        SpellMethodSchema.options.map((method) => (
          <Button size='xs' variant='good' key={method} aria-label={`learn ${row.name} ${method}`}
            title={row.blocked[method] || `learn ${method}`} disabled={row.blocked[method] !== ''}
            onClick={() => learn(row.key, method)}>{method[0]}</Button>
        ))
      } />
    )} />
  )
}

// One spell of the catalog: its name, knowledge and DL, what `action` offers
// beside it, and a click that unfolds the book's entry.
export function SpellCatalogEntry({ row, action }: { row: SpellCatalogRow; action: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='flex flex-col'>
      <div className='flex flex-row items-center'>
        <button type='button' aria-label={`${row.name} details`}
          className='text-left px-1 rounded text-sm grow cursor-pointer hover:bg-raised'
          onClick={() => setOpen(!open)}>
          {row.name}
          <span className='text-xs text-muted'> · {row.knowledge} · DL {row.DL ?? '?'}</span>
        </button>
        {action}
      </div>
      {
        open ?
        <div className='flex flex-col gap-1 px-2 pb-1 text-xs'>
          <span><span className='text-muted'>cost</span> {row.costText} · <span className='text-muted'>{row.type}</span></span>
          {row.requirements ? <span><span className='text-muted'>requires</span> {row.requirements}</span> : null}
          {row.unmet ? <span className='text-bad'>missing {row.unmet}</span> : null}
          {row.castRequirements ? <span><span className='text-muted'>cast with</span> {row.castRequirements}</span> : null}
          <span>{row.description}</span>
          {row.enhance ? <span><span className='text-muted'>enhance</span> {row.enhance}</span> : null}
        </div>
        : null
      }
    </div>
  )
}
