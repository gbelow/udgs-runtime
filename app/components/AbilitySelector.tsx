'use client'
import { useState } from 'react'
import { useAbilityLens } from '../hooks/useAbilityLens'
import type { AbilityFamilyView } from '../domain/character/lenses/abilities'

// Browse the catalog one family per row; a click learns the next stage. The
// stage descriptions unfold under the row so the reader can see what each
// stage adds before committing.
export function AbilitySelector(){
  const { catalog, learn } = useAbilityLens()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const needle = filter.trim().toLowerCase()
  const visible = needle ? catalog.filter((row) => row.family.toLowerCase().includes(needle)) : catalog
  const sections = visible.reduce<Record<string, AbilityFamilyView[]>>((acc, row) => {
    (acc[row.section] ??= []).push(row)
    return acc
  }, {})

  return(
    <div className='flex flex-col w-full gap-1'>
      <input className='p-1 border border-white rounded w-full text-sm' type='text' placeholder='filter' aria-label='ability filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
      {
        Object.entries(sections).map(([section, rows]) => (
          <div key={section} className='flex flex-col'>
            <span className='text-xs uppercase text-gray-400 px-1 pt-1'>{section}</span>
            {rows.map((row) => (
              <div key={row.family} className='flex flex-col'>
                <div className='flex flex-row items-center'>
                  <button type='button' aria-label={`${row.family} details`}
                    className='text-left px-1 hover:bg-gray-500 text-sm grow'
                    onClick={() => setOpen(open === row.family ? null : row.family)}>
                    {row.family}
                    {row.progress ? <span className='text-xs text-gray-400'> {row.progress}</span> : null}
                    <span className='text-xs text-gray-400'> · {row.usage}</span>
                  </button>
                  {
                    row.next ?
                    <input type='button' aria-label={`learn ${row.next.name}`} value={row.stages.length > 1 ? `+ ${row.next.name}` : '+ learn'}
                      className='border border-green-400 text-green-300 rounded px-1 text-xs'
                      onClick={() => learn(row.next!.key)} />
                    : <span className='text-xs text-gray-400 px-1'>learned</span>
                  }
                </div>
                {
                  open === row.family ?
                  <div className='flex flex-col gap-1 px-2 pb-1 text-xs text-gray-300'>
                    {row.stages.map((stage) => (
                      <div key={stage.key} className={stage.learned ? 'text-green-300' : ''}>
                        <span className='font-bold'>{stage.name}</span> — {stage.description || 'nothing new at this level'}
                      </div>
                    ))}
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
