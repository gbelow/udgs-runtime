'use client'
import { useState } from 'react'
import { useAbilityLens } from '../hooks/useAbilityLens'
import { Button, Panel, Row } from './ui'

// The abilities a character has learned, one row per family. A click on the
// name unfolds every stage's text (learned stages highlighted); the button
// steps the family back one stage, the mirror of the sidebar's learn button.
export function AbilityPanel(){
  const { learned, forget, toggle, use } = useAbilityLens()
  const [open, setOpen] = useState<string | null>(null)

  return(
    <Panel title='Abilities'>
      {
        learned.length === 0 ?
        <span className='text-xs text-muted'>none learned</span> :
        learned.map((row) => (
          <div key={row.family} className='flex flex-col gap-1'>
            <Row>
              <button type='button' aria-label={`${row.family} details`} className='text-left grow text-sm cursor-pointer hover:text-accent'
                onClick={() => setOpen(open === row.family ? null : row.family)}>
                <span>{row.family}</span>
                {row.progress ? <span className='text-xs text-muted'> {row.progress}</span> : null}
                <span className='text-xs text-muted'> · {row.usage}</span>
              </button>
              {
                row.use ?
                <Button size='xs' variant='good' aria-label={`use ${row.use.name}`} disabled={!row.use.affordable}
                  onClick={() => use(row.use!.key)}>use · {row.use.price}</Button>
                : null
              }
              {
                row.toggle ?
                <Button size='xs' variant={row.active ? 'good' : 'default'} className={row.active ? 'bg-good/15' : ''} aria-label={`toggle ${row.family}`}
                  onClick={() => toggle(row.toggle!.key)}>{row.active ? 'on' : 'off'}</Button>
                : null
              }
              {
                row.top ?
                <Button size='xs' variant='ghost' aria-label={`forget ${row.top.name}`} onClick={() => forget(row.top!.key)}>{row.stages.length > 1 ? `− ${row.top.name}` : '− forget'}</Button>
                : null
              }
            </Row>
            {
              open === row.family ?
              <div className='flex flex-col gap-1 px-2 pb-1 text-xs'>
                {row.stages.map((stage) => (
                  <div key={stage.key} className={stage.learned ? '' : 'text-muted'}>
                    <span className={stage.learned ? 'text-good' : ''}>{stage.name}</span> — {stage.description || 'nothing new at this level'}
                  </div>
                ))}
              </div>
              : null
            }
          </div>
        ))
      }
    </Panel>
  )
}
