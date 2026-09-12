'use client'
import { useState } from 'react'
import { useAbilityLens } from '../hooks/useAbilityLens'

// The abilities a character has learned, one row per family. A click on the
// name unfolds every stage's text (learned stages highlighted); the button
// steps the family back one stage, the mirror of the sidebar's learn button.
export function AbilityPanel(){
  const { learned, forget } = useAbilityLens()
  const [open, setOpen] = useState<string | null>(null)

  return(
    <div className='flex flex-col w-84 md:w-full gap-1'>
      <span className='font-bold text-center'>Abilities</span>
      {
        learned.length === 0 ?
        <span className='text-xs text-gray-400 text-center'>none learned</span> :
        learned.map((row) => (
          <div key={row.family} className='flex flex-col border rounded p-1 text-left text-sm'>
            <div className='flex flex-row gap-2 items-center'>
              <button type='button' aria-label={`${row.family} details`} className='text-left grow hover:bg-gray-500'
                onClick={() => setOpen(open === row.family ? null : row.family)}>
                <span className='font-bold'>{row.family}</span>
                {row.stages.length > 1 ? <span className='text-xs text-gray-400'> {row.learnedStage}/{row.stages.length}</span> : null}
                <span className='text-xs text-gray-400'> · {row.usage}</span>
              </button>
              {
                row.top ?
                <input type='button' aria-label={`forget ${row.top.name}`} value={row.stages.length > 1 ? `− ${row.top.name}` : '− forget'}
                  className='border rounded px-1 text-xs' onClick={() => forget(row.top!.key)} />
                : null
              }
            </div>
            {
              open === row.family ?
              <div className='flex flex-col gap-1 px-1 pt-1 text-xs'>
                {row.stages.map((stage) => (
                  <div key={stage.key} className={stage.learned ? 'text-green-300' : 'text-gray-500'}>
                    <span className='font-bold'>{stage.name}</span> — {stage.description}
                  </div>
                ))}
              </div>
              : null
            }
          </div>
        ))
      }
    </div>
  )
}
