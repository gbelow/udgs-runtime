'use client'
import { useState } from 'react'
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
      <input className='p-1 border border-white rounded w-full text-sm' type='text' placeholder='filter' aria-label='spell filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
      {
        Object.entries(sections).map(([section, rows]) => (
          <div key={section} className='flex flex-col'>
            <span className='text-xs uppercase text-gray-400 px-1 pt-1'>{section}</span>
            {rows.map((row) => (
              <div key={row.key} className='flex flex-col'>
                <div className='flex flex-row items-center'>
                  <button type='button' aria-label={`${row.name} details`}
                    className='text-left px-1 hover:bg-gray-500 text-sm grow'
                    onClick={() => setOpen(open === row.key ? null : row.key)}>
                    {row.name}
                    <span className='text-xs text-gray-400'> · {row.knowledge} · DL {row.DL ?? '?'}</span>
                  </button>
                  {
                    row.learned ?
                    <span className='text-xs text-gray-400 px-1'>learned</span> :
                    METHODS.map((method) => (
                      <input key={method} type='button' aria-label={`learn ${row.name} ${method}`} value={method[0]}
                        title={`learn ${method}`} disabled={!row.learnable[method]}
                        className='border border-green-400 text-green-300 rounded px-1 text-xs disabled:opacity-30'
                        onClick={() => learn(row.key, method)} />
                    ))
                  }
                </div>
                {
                  open === row.key ?
                  <div className='flex flex-col gap-1 px-2 pb-1 text-xs text-gray-300'>
                    <span><span className='text-gray-400'>cost</span> {row.costText} · <span className='text-gray-400'>{row.type}</span></span>
                    {row.requirements ? <span><span className='text-gray-400'>requires</span> {row.requirements}</span> : null}
                    <span>{row.description}</span>
                    {row.enhance ? <span><span className='text-gray-400'>enhance</span> {row.enhance}</span> : null}
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
