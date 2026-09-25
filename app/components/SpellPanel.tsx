'use client'
import { useState } from 'react'
import { useSpellLens } from '../hooks/useSpellLens'
import { Button, Panel, Row } from './ui'

// The spells a character knows, one row per spell: the skill it is cast
// with, the casting DL and, unfolded, the test the target makes and what each
// degree does. Casting is done from the fight's action panel; a held spell
// can be let go of here.
export function SpellPanel(){
  const { learned, forget, practice, release } = useSpellLens()
  const [open, setOpen] = useState<string | null>(null)

  return(
    <Panel title='Spells'>
      {
        learned.length === 0 ?
        <span className='text-xs text-muted'>none learned</span> :
        learned.map((row) => (
          <div key={row.key} className='flex flex-col gap-1'>
            <Row>
              <button type='button' aria-label={`${row.name} details`} className='text-left grow text-sm cursor-pointer hover:text-accent'
                onClick={() => setOpen(open === row.key ? null : row.key)}>
                <span>{row.name}</span>
                <span className='text-xs text-muted'> · {row.method} · skill {row.skill} · DL {row.DL ?? '?'}</span>
              </button>
              <span className='flex flex-row items-center gap-1 text-xs text-muted'>
                <button type='button' aria-label={`practice ${row.name} down`} className='hover:text-fg cursor-pointer' onClick={() => practice(row.key, -1)}>−</button>
                <span className='font-mono text-fg' title='practice'>{row.practice}</span>
                <button type='button' aria-label={`practice ${row.name} up`} className='hover:text-fg cursor-pointer' onClick={() => practice(row.key, 1)}>+</button>
              </span>
              {
                row.active ?
                <Button size='xs' variant='good' className='bg-good/15' aria-label={`release ${row.name}`} onClick={() => release(row.key)}>release</Button>
                : null
              }
              <Button size='xs' variant='ghost' aria-label={`forget ${row.name}`} onClick={() => forget(row.key)}>− forget</Button>
            </Row>
            {
              open === row.key ?
              <div className='flex flex-col gap-1 px-2 pb-1 text-xs'>
                <span><span className='text-muted'>cost</span> {row.costText} · <span className='text-muted'>{row.type}</span>{row.range ? <> · {row.range}</> : null}</span>
                <span><span className='text-muted'>as miracle</span> skill {row.miracle}</span>
                {row.hitAt !== null ? <span><span className='text-muted'>hit at</span> {row.hitAt}</span> : null}
                {
                  row.test ?
                  <span><span className='text-muted'>target rolls</span> {row.test.roll} vs {row.test.value ?? ''}{row.test.extra ? `${row.test.value !== null ? ' + ' : ''}${row.test.extra}` : ''}</span>
                  : null
                }
                {row.effects.map((e, i) => (
                  <span key={i}><span className='text-muted'>{e.kind}</span> {e.text} <span className='text-muted'>→ {e.target}{e.range ? ` · ${e.range}` : ''}</span>
                    {e.test ? <span> · <span className='text-muted'>target rolls</span> {e.test.roll} vs {e.test.value ?? ''}{e.test.extra ? `${e.test.value !== null ? ' + ' : ''}${e.test.extra}` : ''}</span> : null}
                  </span>
                ))}
                {row.outcomes.map((o) => <span key={o.degree}><span className='text-muted'>{o.degree}</span> {o.text}</span>)}
                <span>{row.description}</span>
                {row.enhance ? <span><span className='text-muted'>enhance</span> {row.enhance}</span> : null}
              </div>
              : null
            }
          </div>
        ))
      }
    </Panel>
  )
}
