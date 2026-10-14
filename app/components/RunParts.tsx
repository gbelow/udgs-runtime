'use client'
import { useState, type ReactNode } from 'react'
import { CharacterSelector } from './CharacterSelector'
import { Button, SectionLabel } from './ui'
import { useClock } from '../hooks/useParty'
import { useRole } from '../hooks/useRole'
import type { Character } from '../domain/types'
import type { TestRoll } from '../domain/play/test'

// What the run screen's modes draw alike.

// The character catalog, opened beside a roster or a party: whoever is
// picked joins it, as `onSelect` says or else as the tab loads a character.
// The catalog is the GM's; a player brings in only PCs.
export function CatalogDrawer({ label, close, bar = null, onSelect }: { label: string, close: () => void, bar?: string | null, onSelect?: (c: Character) => void }){
  const { gmTools } = useRole()

  return(
    <div className='flex flex-col gap-1 p-2 rounded border border-accent w-64 shrink-0'>
      <div className='flex flex-row gap-1 items-center'>
        <SectionLabel>{label}</SectionLabel>
        <Button size='xs' variant='ghost' className='ml-auto' aria-label='close catalog' onClick={close}>×</Button>
      </div>
      {bar ? <span className='text-xs text-muted'>{bar}</span> : null}
      {gmTools ? null : <span className='text-xs text-muted'>the catalog is the GM&apos;s: only PCs can be added</span>}
      <fieldset disabled={bar !== null} className='min-w-0'>
        <CharacterSelector catalog={gmTools} onSelect={onSelect} />
      </fieldset>
    </div>
  )
}

// The roster out of a fight, with the catalog that adds to it opened beside.
export function RosterCatalog({ children }: { children: ReactNode }){
  const [open, setOpen] = useState(false)

  return(
    <div className='flex flex-col gap-2'>
      <Button size='xs' className={`self-start ${open ? 'bg-accent/15' : ''}`} aria-label='add characters' aria-pressed={open} variant={open ? 'primary' : 'default'} onClick={() => setOpen(!open)}>add characters</Button>
      <div className='flex flex-row gap-3 items-start'>
        {open ? <CatalogDrawer label='adding to the roster' close={() => setOpen(false)} /> : null}
        <div className='flex flex-col gap-2 flex-1 min-w-0'>{children}</div>
      </div>
    </div>
  )
}

// One character on a strip along the top: a click picks them.
export function RosterChip({ name, active, note, bad = false, disabled = false, onClick }: { name: string, active: boolean, note: ReactNode, bad?: boolean, disabled?: boolean, onClick: () => void }){
  return(
    <Button size='xs' aria-label={name} disabled={disabled} variant={active ? 'primary' : 'default'} className={active ? 'bg-accent/15' : ''} onClick={onClick}>
      {name}<span className={`ml-1.5 text-[10px] ${bad ? 'text-bad' : active ? 'text-accent/80' : 'text-muted'}`}>{note}</span>
    </Button>
  )
}

// The clock everyone out of a fight shares.
export function ClockLabel({ children }: { children?: ReactNode }){
  const { day, et, etsPerDay } = useClock()
  return <span className='text-xs text-muted whitespace-nowrap'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/{etsPerDay}{children}</span>
}

// A test as rolled, and what the table noted of it, after what it was for.
export function RollText({ roll, note }: { roll: TestRoll | null, note?: string | null }){
  return <>{roll ? <>: <span className='font-mono text-fg'>{roll.score}</span> vs DL <span className='font-mono text-fg'>{roll.DL}</span>, {roll.degree}</> : null}{note ? ` — ${note}` : ''}</>
}
