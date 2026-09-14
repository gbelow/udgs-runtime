'use client'
import { useState } from 'react'
import { useSpellLens } from '../hooks/useSpellLens'

// The spells a character knows, one row per spell: the skill it is cast
// with, the casting DL and, unfolded, what the roll needs to reach for each
// enhancement level, the test the target makes and what each degree does.
// In play the button pays the cost; a held sustained spell shows as on.
export function SpellPanel(){
  const { learned, forget, practice, cast } = useSpellLens()
  const [open, setOpen] = useState<string | null>(null)

  return(
    <div className='flex flex-col w-84 md:w-full gap-1'>
      <span className='font-bold text-center'>Spells</span>
      {
        learned.length === 0 ?
        <span className='text-xs text-gray-400 text-center'>none learned</span> :
        learned.map((row) => (
          <div key={row.key} className='flex flex-col border rounded p-1 text-left text-sm'>
            <div className='flex flex-row gap-2 items-center'>
              <button type='button' aria-label={`${row.name} details`} className='text-left grow hover:bg-gray-500'
                onClick={() => setOpen(open === row.key ? null : row.key)}>
                <span className='font-bold'>{row.name}</span>
                <span className='text-xs text-gray-400'> · {row.method} · skill {row.skill} · DL {row.DL ?? '?'}</span>
              </button>
              <div className='flex flex-row items-center text-xs'>
                <input type='button' aria-label={`practice ${row.name} down`} value='−' className='border rounded px-1' onClick={() => practice(row.key, -1)} />
                <span className='px-1' title='practice'>{row.practice}</span>
                <input type='button' aria-label={`practice ${row.name} up`} value='+' className='border rounded px-1' onClick={() => practice(row.key, 1)} />
              </div>
              {
                row.canCast ?
                <input type='button' aria-label={`cast ${row.name}`} value={row.active ? 'release' : `cast · ${row.price}`}
                  className={'border rounded px-1 text-xs ' + (row.active ? 'bg-green-300 text-black' : 'border-green-400 text-green-300')}
                  onClick={() => cast(row.key)} />
                : null
              }
              <input type='button' aria-label={`forget ${row.name}`} value='− forget' className='border rounded px-1 text-xs' onClick={() => forget(row.key)} />
            </div>
            {
              open === row.key ?
              <div className='flex flex-col gap-1 px-1 pt-1 text-xs text-gray-300'>
                <span><span className='text-gray-400'>cost</span> {row.costText} · <span className='text-gray-400'>{row.type}</span>{row.range ? <> · {row.range}</> : null}</span>
                <span><span className='text-gray-400'>as miracle</span> skill {row.miracle}</span>
                {
                  row.enhancements.length ?
                  <span><span className='text-gray-400'>roll for</span> {row.enhancements.map((e) => `${e.level === 0 ? 'hit' : `+${e.level}`} ≥ ${e.target}`).join(' · ')}</span>
                  : row.hitAt !== null ? <span><span className='text-gray-400'>roll for</span> hit ≥ {row.hitAt}</span> : null
                }
                {
                  row.test ?
                  <span><span className='text-gray-400'>target rolls</span> {row.test.roll} vs {row.test.value ?? ''}{row.test.extra ? `${row.test.value !== null ? ' + ' : ''}${row.test.extra}` : ''}</span>
                  : null
                }
                {row.damage ? <span><span className='text-gray-400'>damage</span> {row.damage}</span> : null}
                {row.outcomes.map((o) => <span key={o.degree}><span className='text-gray-400'>{o.degree}</span> {o.text}</span>)}
                <span>{row.description}</span>
                {row.enhance ? <span><span className='text-gray-400'>enhance</span> {row.enhance}</span> : null}
                <span className='text-gray-500'>{row.modifications.map((m) => `${m.name} ${m.SOP} SOP`).join(' · ')}</span>
              </div>
              : null
            }
          </div>
        ))
      }
    </div>
  )
}
