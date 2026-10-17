'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel } from './ui'
import { LockedFor } from './Locks'
import type { CallRow } from '../domain/play/calls'
import { useDicePlace } from '../hooks/useProfile'
import { useDieBar } from '../hooks/useDieCalls'

type Answer = (id: string, die: number | null) => void

// The tests a sequence has called for: each waiting on the die of whoever
// makes it, typed in from the table or rolled here, and those answered
// already, until the step that called them goes on. The GM may roll any of
// them.
export function DieCalls({ rows, answer }: { rows: CallRow[], answer: Answer }){
  if (rows.length === 0) return null
  return(
    <div className='flex flex-col gap-1 pb-2 border-b border-line'>
      <SectionLabel>Dice called for</SectionLabel>
      {rows.map((row) => <DieCallRow key={row.id} row={row} answer={answer} />)}
    </div>
  )
}

function DieCallRow({ row, answer }: { row: CallRow, answer: Answer }){
  const dieBar = useDieBar()
  const place = useDicePlace()
  const [die, setDie] = useState('')
  const typed = die.trim() === '' ? null : Number(die)
  const bar = typed === null ? 'type the die rolled' : dieBar(typed, row.explodes)
  return(
    <div className='flex flex-row flex-wrap gap-x-2 gap-y-0.5 items-center text-xs'>
      <span>{row.name}</span>
      <span className='text-muted'>{row.label}</span>
      {row.skill !== null ? <span className='text-muted'>skill <span className='font-mono text-fg'>{row.skill}</span> vs DL <span className='font-mono text-fg'>{row.DL}</span></span> : null}
      {row.how.map((h) => <span key={h} className='text-muted'>{h}</span>)}
      {row.result ? <span className='font-mono text-fg'>{row.result}</span> :
        <LockedFor id={row.roller} className='contents'>
          <form className='flex flex-row gap-1 items-center' onSubmit={(e) => { e.preventDefault(); if (typed !== null && !bar) answer(row.id, typed) }}>
            <NumberInput className='w-12' aria-label='die rolled' placeholder='die' value={die} onChange={(e) => setDie(e.target.value)} />
            <Button type='submit' size='xs' variant='primary' disabled={bar !== null} title={bar ?? undefined}>enter</Button>
            <Button size='xs' onClick={() => answer(row.id, null)}>{place === 'tray' ? 'throw' : 'roll here'}</Button>
          </form>
        </LockedFor>}
    </div>
  )
}

// The buttons that make a test whose die the screen would roll: for whoever
// rolls their own dice at the table, a field for the die first, which every
// button then answers with. The screen rolls these for whoever throws in the
// dice tray.
export function RollButtons<K extends string>({ options, name, onRoll }: { options: { key: K, label: string }[], name: string, onRoll: (key: K, die?: number) => void }){
  const manual = useDicePlace() === 'table'
  const dieBar = useDieBar()
  const [die, setDie] = useState('')
  const typed = die.trim() === '' ? null : Number(die)
  const bar = !manual ? null : typed === null ? 'type the die rolled' : dieBar(typed)
  return(
    <>
      {manual ? <NumberInput className='w-12' aria-label={`die rolled ${name}`} placeholder='die' value={die} onChange={(e) => setDie(e.target.value)} /> : null}
      {options.map((o) => (
        <Button key={o.key} size='xs' variant='primary' aria-label={`${o.label} ${name}`} disabled={bar !== null} title={bar ?? undefined}
          onClick={() => { onRoll(o.key, manual && typed !== null ? typed : undefined); setDie('') }}>{o.label}</Button>
      ))}
    </>
  )
}
