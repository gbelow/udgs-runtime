'use client'
import { useState } from 'react'
import { useSpellLens } from '../hooks/useSpellLens'
import { Button, Panel, Row, Tooltip } from './ui'

// The spells a character knows, one row per spell: the skill it is cast
// with, the casting DL and, unfolded, the test the target makes and what each
// degree does. In play the cast button rolls and pays; quicken rolls at +4 DL
// without the focus surge. The roll's SOPs then show under the row with one
// button per improvement, lit by how many times it was bought.
export function SpellPanel(){
  const { learned, forget, practice, cast, modify, resolve } = useSpellLens()
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
                <Button size='xs' variant='good' className='bg-good/15' aria-label={`release ${row.name}`} onClick={() => cast(row.key)}>release</Button>
                : <>
                  <Button size='xs' variant='good' aria-label={`cast ${row.name}`} disabled={!row.canCast} onClick={() => cast(row.key)}>cast · {row.price}</Button>
                  <Button size='xs' variant='primary' aria-label={`quicken ${row.name}`} disabled={!row.canQuicken} onClick={() => cast(row.key, true)}>quicken · DL {row.quickenedDL ?? '?'}</Button>
                </>
              }
              <Button size='xs' variant='ghost' aria-label={`forget ${row.name}`} onClick={() => forget(row.key)}>− forget</Button>
            </Row>
            {
              row.pending ?
              <div className='flex flex-row flex-wrap gap-1 items-center px-2 text-xs'>
                <span className={row.pending.hit ? 'text-good' : 'text-bad'}>
                  rolled {row.pending.score} · {row.pending.hit ? `${row.pending.SOP} SOP left` : 'miss'}
                </span>
                {row.pending.modifications.map((m) => (
                  <Tooltip key={m.name} text={m.text}>
                    <Button size='xs' aria-label={`${m.name} ${row.name}`} disabled={!m.affordable}
                      variant={m.times ? 'good' : 'default'} className={m.times ? 'bg-good/15' : ''}
                      onClick={() => modify(m.name)}>{m.name} {m.SOP}{m.times ? ` ×${m.times}` : ''}</Button>
                  </Tooltip>
                ))}
                <Button size='xs' variant='primary' aria-label={`resolve ${row.name}`} onClick={resolve}>done</Button>
              </div>
              : null
            }
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
                {row.damage ? <span><span className='text-muted'>damage</span> {row.damage}</span> : null}
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
