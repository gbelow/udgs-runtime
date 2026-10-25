'use client'
import { useState, type ReactNode } from 'react'
import { CharacterSelector } from './CharacterSelector'
import { useCollectionFilter } from '../hooks/useCollections'
import { Button, CollectionSelect, MenuSection, SectionLabel, barred, selectClass } from './ui'
import { useMoments, usePartyCommands } from '../hooks/useParty'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import { usePlayedBy } from '../hooks/useCampaign'
import { useTableLink } from '../hooks/useTable'
import { useViewAs } from '../hooks/useViewAs'
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
  if (moments.length === 0) return <span className='text-xs text-muted whitespace-nowrap'>no party is running on a timeline</span>
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
// and whether it is running or frozen.
export function TimelineSummary({ timeline }: { timeline: TimelineView }){
  const { clock, night, active } = timeline
  return(
    <span className='flex flex-row flex-wrap gap-x-1.5 text-xs text-muted'>
      {clock ? <Moment clock={clock} night={night} /> : <span className='text-fg'>outside time</span>}
      <span>· {active ? 'running' : 'frozen'}</span>
    </span>
  )
}

// Whether a party is running or frozen, the GM's, in the party's menu; where it stands
// on the timeline is moved from the Campaign tab's timeline.
export function TimelineControl({ timeline }: { timeline: TimelineView }){
  const { setActive } = usePartyCommands()
  const bar = useGmBar()
  const { name, clock, active } = timeline

  return(
    <MenuSection label='timeline'>
      <label className='flex items-center gap-1 text-xs'>
        <input type='checkbox' aria-label={`${name} running`} {...barred(bar)} checked={active} onChange={(e) => setActive(timeline.partyId, e.target.checked)} />running
      </label>
      {bar ? <span className='text-[10px] text-muted'>{bar}</span> : null}
      {clock ? null : <span className='text-[10px] text-muted'>not in the timeline: only the scene is open until it is placed and running</span>}
    </MenuSection>
  )
}

const LINK_STATUS = { connecting: 'connecting', open: 'at the table', noHost: 'waiting for the GM to host', closed: 'gave up reconnecting' } as const

const linkText = (status: keyof typeof LINK_STATUS, attempt: number) => status === 'connecting' && attempt > 0 ? `link lost, reconnecting (try ${attempt})` : LINK_STATUS[status]

const LINK_DOT = { connecting: 'bg-muted animate-pulse', open: 'bg-good', noHost: 'bg-muted animate-pulse', closed: 'bg-bad' } as const

const Dot = ({ className }: { className: string }) => <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${className}`} />

// The screen's link to the table, beside the name of the campaign it runs: a
// GM hosts the campaign open on their screen, and anyone else joins the table
// of a campaign they play, without opening it first.
export function TableLink(){
  const { mode, status, why, attempt, campaign, guests, canHost, played, host, join, reconnect, leave } = useTableLink()
  const named = campaign.name !== ''

  return (
    <div className='flex flex-row items-center gap-2 shrink-0 text-xs'>
      {named || canHost ? (
        <span className='inline-flex items-baseline gap-1.5 min-w-0' title='the campaign this screen runs'>
          <span className='text-[10px] uppercase tracking-wide text-muted'>campaign</span>
          <span className={`max-w-56 truncate ${named ? 'text-sm font-medium text-fg' : 'italic text-muted'}`}>{named ? campaign.name : 'unsaved'}</span>
          {campaign.locked ? <span className='text-[10px] text-muted'>locked</span> : null}
        </span>
      ) : null}
      {!mode ? (canHost ? (
        <Button variant='primary' aria-label='host table' title='let the players join this campaign from their screens' onClick={host}>
          <span className='inline-flex items-center gap-1.5'><Dot className='bg-current' />host table</span>
        </Button>
      ) : played.length > 0 ? (
        <select aria-label='join table' className={`${selectClass} w-fit`} value='' onChange={(e) => { const c = played.find((p) => p.id === e.target.value); if (c) join(c.id, c.name) }}>
          <option value=''>join a table…</option>
          {played.map((c) => <option key={c.id} value={c.id}>{c.name || '—'}</option>)}
        </select>
      ) : (
        <span className='text-[10px] text-muted'>no table to join: you play in no campaign yet</span>
      )) : (
        <span className='inline-flex items-center gap-1.5 rounded border border-line bg-surface pl-2 pr-0.5 py-0.5'>
          <Dot className={LINK_DOT[status]} />
          <span className='text-muted' title={mode === 'host' && guests.length > 0 ? guests.map((g) => g.name).join(', ') : undefined}>
            {status === 'open' && mode === 'host' ? `hosting · ${guests.length} joined` : linkText(status, attempt)}{(status === 'closed' || attempt > 0) && why ? `: ${why}` : ''}
          </span>
          {status === 'closed' ? <Button size='xs' aria-label='reconnect table' onClick={reconnect}>reconnect</Button> : null}
          <Button size='xs' variant='ghost' aria-label='leave table' onClick={leave}>leave</Button>
        </span>
      )}
    </div>
  )
}

// What a screen that joined a table shows until the host's state is on it,
// in place of its own, which is not the table's.
export function TableWait(){
  const { status, why, attempt, roomName } = useTableLink()
  return (
    <div className='flex-1 flex items-center justify-center text-sm text-muted p-4 text-center'>
      {status === 'connecting' ? (attempt > 0 ? `The link to the table of ${roomName || 'the campaign'} was lost${why ? ` (${why})` : ''}. Reconnecting, try ${attempt}…` : `Connecting to the table of ${roomName || 'the campaign'}…`)
        : status === 'noHost' ? `Waiting for the GM to host ${roomName || 'the campaign'}. The table appears here as soon as they do.`
        : `The link to the table of ${roomName || 'the campaign'} is closed${why ? `: ${why}` : ''}. It stopped trying to reconnect: reconnect or leave from the corner above.`}
    </div>
  )
}

// The GM checks what the table shows a player: who they play, the tokens they
// see, who the fight leaves out of their view, and how much of the logs they get.
export function ViewAs(){
  const [profile, setProfile] = useState('')
  const { players, summary } = useViewAs(profile)
  const list = (names: string[]) => names.length > 0 ? names.join(', ') : '—'

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row gap-1 items-center'>
        <SectionLabel>view as</SectionLabel>
        <select aria-label='view as player' className={`${selectClass} w-fit`} value={profile} onChange={(e) => setProfile(e.target.value)}>
          <option value=''>nobody</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {summary ? (
        <dl className='grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted'>
          <dt>plays</dt><dd className='text-fg'>{list(summary.played)}</dd>
          <dt>sees as tokens</dt><dd className='text-fg'>{list(summary.tokens)}</dd>
          <dt>left out of the fight</dt><dd className='text-fg'>{list(summary.leftOut)}</dd>
          <dt>party-mates</dt><dd className='text-fg'>{list(summary.partyMates)}</dd>
          <dt>parties</dt><dd className='text-fg'>{summary.parties.shown} of {summary.parties.of}</dd>
          <dt>journal</dt><dd className='text-fg'>{summary.journal.shown} of {summary.journal.of}</dd>
          <dt>fight log</dt><dd className='text-fg'>{summary.log.shown} of {summary.log.of}</dd>
        </dl>
      ) : null}
    </div>
  )
}
