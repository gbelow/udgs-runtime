'use client'
import { useState, type ReactNode } from 'react'
import { CharacterSelector } from './CharacterSelector'
import { useCollectionFilter } from '../hooks/useCollections'
import { Button, CollectionSelect, MenuSection, SectionLabel, barred, selectClass } from './ui'
import { useMoments, usePartyCommands } from '../hooks/useParty'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import { usePlayedBy } from '../hooks/useCampaign'
import type { Character } from '../domain/types'
import type { TimelineView } from '../domain/campaign/projections/timeline'
import type { ClockView } from '../domain/campaign/projections/clock'

// What the run screen's modes draw alike.

// Who plays a character, in their menu: the GM gives them to a member of the
// campaign, or takes them back.
export function PlayedBy({ id, name }: { id: string, name: string }){
  const { owner, options, bar, set } = usePlayedBy(id)
  return (
    <MenuSection label='played by'>
      <select aria-label={`${name} played by`} className={selectClass} disabled={bar !== null} title={bar ?? 'who plays them'}
        value={owner ?? ''} onChange={(e) => set(e.target.value || null)}>
        <option value=''>the GM</option>
        {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {bar ? <span className='text-[10px] text-muted'>{bar}</span> : null}
    </MenuSection>
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

// When a party is, in one line under its name: its moment or outside time,
// and whether it is in play.
export function TimelineSummary({ timeline }: { timeline: TimelineView }){
  const { clock, night, active } = timeline
  return(
    <span className='flex flex-row flex-wrap gap-x-1.5 text-xs text-muted'>
      {clock ? <Moment clock={clock} night={night} /> : <span className='text-fg'>outside time</span>}
      <span>· {active ? 'in play' : 'not in play'}</span>
    </span>
  )
}

// Whether a party is in play, the GM's, in the party's menu; where it stands
// on the timeline is moved from the Campaign tab's timeline.
export function TimelineControl({ timeline }: { timeline: TimelineView }){
  const { setActive } = usePartyCommands()
  const bar = useGmBar()
  const { name, clock, active } = timeline

  return(
    <MenuSection label='timeline'>
      <label className='flex items-center gap-1 text-xs'>
        <input type='checkbox' aria-label={`${name} in play`} {...barred(bar)} checked={active} onChange={(e) => setActive(timeline.partyId, e.target.checked)} />in play
      </label>
      {bar ? <span className='text-[10px] text-muted'>{bar}</span> : null}
      {active && !clock ? <span className='text-[10px] text-muted'>outside time, {name} feels no time pass until it is placed on a timeline</span> : null}
    </MenuSection>
  )
}
