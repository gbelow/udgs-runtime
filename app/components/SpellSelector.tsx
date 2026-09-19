'use client'
import { useState } from 'react'
import { Button, SectionLabel, TextInput } from './ui'
import { useSpellLens } from '../hooks/useSpellLens'
import type { SpellCatalogRow } from '../domain/character/lenses/spells'
import type { SpellMethod } from '../domain/types'

const METHODS: SpellMethod[] = ['intuitive', 'wizard', 'cleric']

// Browse the catalog one spell per row, grouped by school. A click unfolds
// the book's entry; the buttons learn it by one of the three methods, which
// decides the skill it is cast with.
export function SpellSelector(){
  const { catalog, learn } = useSpellLens()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const needle = filter.trim().toLowerCase()
  const visible = needle ? catalog.filter((row) => row.name.toLowerCase().includes(needle)) : catalog
  const sections = visible.reduce<Record<string, SpellCatalogRow[]>>((acc, row) => {
    (acc[row.section] ??= []).push(row)
    return acc
  }, {})

  return(
    <div className='flex flex-col w-full gap-1'>
      <TextInput className='w-full' placeholder='filter' aria-label='spell filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
      {
        Object.entries(sections).map(([section, rows]) => (
          <div key={section} className='flex flex-col'>
            <SectionLabel className='px-1 pt-2'>{section}</SectionLabel>
            {rows.map((row) => (
              <div key={row.key} className='flex flex-col'>
                <div className='flex flex-row items-center'>
                  <button type='button' aria-label={`${row.name} details`}
                    className='text-left px-1 rounded text-sm grow cursor-pointer hover:bg-raised'
                    onClick={() => setOpen(open === row.key ? null : row.key)}>
                    {row.name}
                    <span className='text-xs text-muted'> · {row.knowledge} · DL {row.DL ?? '?'}</span>
                  </button>
                  {
                    row.learned ?
                    <span className='text-xs text-muted px-1'>learned</span> :
                    METHODS.map((method) => (
                      <Button size='xs' variant='good' key={method} aria-label={`learn ${row.name} ${method}`}
                        title={`learn ${method}`} disabled={!row.learnable[method]}
                        onClick={() => learn(row.key, method)}>{method[0]}</Button>
                    ))
                  }
                </div>
                {
                  open === row.key ?
                  <div className='flex flex-col gap-1 px-2 pb-1 text-xs'>
                    <span><span className='text-muted'>cost</span> {row.costText} · <span className='text-muted'>{row.type}</span></span>
                    {row.requirements ? <span><span className='text-muted'>requires</span> {row.requirements}</span> : null}
                    <span>{row.description}</span>
                    {row.enhance ? <span><span className='text-muted'>enhance</span> {row.enhance}</span> : null}
                  </div>
                  : null
                }
              </div>
            ))}
          </div>
        ))
      }
    </div>
  )
}
