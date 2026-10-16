'use client'
import { useState, type ReactNode } from 'react'
import { CharacterSelector } from './CharacterSelector'
import { useCollectionFilter } from '../hooks/useCollections'
import { Button, CollectionSelect, SectionLabel, barred, selectClass } from './ui'
import { useMoments, usePartyCommands } from '../hooks/useParty'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import { usePlayedBy } from '../hooks/useCampaign'
import type { Character } from '../domain/types'
import type { SyncOption, TimelineView } from '../domain/campaign/projections/timeline'
import type { ClockView } from '../domain/campaign/projections/clock'

// What the run screen's modes draw alike.

// Who plays a character: the GM gives them to a member of the campaign, or
// takes them back.
export function PlayedBy({ id, name }: { id: string, name: string }){
  const { owner, options, bar, set } = usePlayedBy(id)
  return (
    <select aria-label={`${name} played by`} className={`${selectClass} min-w-0`} disabled={bar !== null} title={bar ?? 'who plays them'}
      value={owner ?? ''} onChange={(e) => set(e.target.value || null)}>
      <option value=''>played by the GM</option>
      {options.map((p) => <option key={p.id} value={p.id}>played by {p.name}</option>)}
    </select>
  )
}

// The character catalog, opened beside a roster or a party: whoever is
// picked joins it, as `onSelect` says or else as the tab loads a character.
// The catalog is the GM's; a player brings in only PCs.
export function CatalogDrawer({ label, close, bar = null, onSelect }: { label: string, close: () => void, bar?: string | null, onSelect?: (c: Character) => void }){
  const { gmTools } = useRole()
  const filter = useCollectionFilter('characters')

  return(
    <div className='flex flex-col gap-1 p-2 rounded border border-accent w-64 shrink-0'>
      <div className='flex flex-row gap-1 items-center'>
        <SectionLabel>{label}</SectionLabel>
        <Button size='xs' variant='ghost' className='ml-auto' aria-label='close catalog' onClick={close}>×</Button>
      </div>
      {bar ? <span className='text-xs text-muted'>{bar}</span> : null}
      {gmTools ? null : <span className='text-xs text-muted'>the catalog is the GM&apos;s: only PCs can be added</span>}
      {gmTools ? <CollectionSelect label='character collection' filter={filter} /> : null}
      <fieldset disabled={bar !== null} className='min-w-0'>
        <CharacterSelector catalog={gmTools} only={filter.has} onSelect={onSelect} />
      </fieldset>
    </div>
  )
}

// The roster out of a fight, with the catalog that adds to it opened beside.
export function RosterCatalog({ children }: { children: ReactNode }){
  const [open, setOpen] = useState(false)

  return(
    <div className='flex flex-col gap-2'>
      <Button size='xs' className='self-start' aria-label='add characters' aria-pressed={open} selected={open} onClick={() => setOpen(!open)}>add characters</Button>
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
    <Button size='xs' aria-label={name} disabled={disabled} selected={active} onClick={onClick}>
      {name}<span className={`ml-1.5 text-[10px] ${bad ? 'text-bad' : active ? 'text-accent/80' : 'text-muted'}`}>{note}</span>
    </Button>
  )
}

// A moment on a timeline: the day, the ET of it, and whether it is night.
function Moment({ clock, night }: { clock: ClockView, night: boolean }){
  return <span className='whitespace-nowrap'>Day <span className='font-mono text-fg'>{clock.day}</span> · ET <span className='font-mono text-fg'>{clock.et}</span>/{clock.etsPerDay} · <span className='text-fg'>{night ? 'night' : 'daylight'}</span></span>
}

// The moments the parties in play are living, each on its own timeline.
export function ClockLabel(){
  const moments = useMoments()
  if (moments.length === 0) return <span className='text-xs text-muted whitespace-nowrap'>no party in play is on a timeline</span>
  return(
    <span className='flex flex-row flex-wrap gap-x-3 text-xs text-muted'>
      {moments.map((m) => (
        <span key={`${m.clock.day} ${m.clock.et}`} className='whitespace-nowrap'>
          <Moment clock={m.clock} night={m.night} />{moments.length > 1 || m.parties.length > 1 ? ` (${m.parties.join(', ')})` : ''}
        </span>
      ))}
    </span>
  )
}

// When a party is and whether it is in play; the GM brings it to another
// timeline's time, always forward, reading what that does to it first.
export function TimelineControl({ timeline }: { timeline: TimelineView }){
  const { setActive, sync } = usePartyCommands()
  const bar = useGmBar()
  const [chosen, setChosen] = useState<SyncOption | null>(null)
  const { name, clock, night, active, options } = timeline

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center text-xs text-muted'>
        {clock
          ? <Moment clock={clock} night={night} />
          : <span className='text-fg'>outside time</span>}
        <label className='flex items-center gap-1'>
          <input type='checkbox' aria-label={`${name} in play`} {...barred(bar)} checked={active} onChange={(e) => setActive(timeline.partyId, e.target.checked)} />in play
        </label>
        {options.length > 0 ?
          <select aria-label={`${name} sync`} className={selectClass} {...barred(bar)} value='' onChange={(e) => setChosen(options[parseInt(e.target.value)] ?? null)}>
            <option value=''>sync…</option>
            {options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
          : null}
      </div>
      {active && !clock ? <span className='text-xs text-muted'>outside time, {name} feels no time pass until it is placed on a timeline</span> : null}
      {chosen ?
        <div className='flex flex-row flex-wrap gap-1.5 items-center text-xs border border-accent rounded p-1'>
          <span className='text-fg'>{chosen.warning}</span>
          <Button size='xs' variant='primary' aria-label={`${name} confirm sync`} onClick={() => { sync(timeline.partyId, chosen.how, chosen.to); setChosen(null) }}>{chosen.how === 'pass' ? 'live it' : 'place'}</Button>
          <Button size='xs' aria-label={`${name} cancel sync`} onClick={() => setChosen(null)}>cancel</Button>
        </div>
        : null}
    </div>
  )
}
