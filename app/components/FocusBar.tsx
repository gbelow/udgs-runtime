'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import type { Gauges } from '../domain/character/lenses/bars'
import type { TargetRow } from '../domain/scene/projections/focus'
import type { FaceCard } from '../domain/scene/projections/cards'
import { useFaceColumn, useOwnChips, useTargetRows } from '../hooks/useFocusBar'
import { SHADE_BG, shadeOf, type GaugeKey } from '../gaugeShades'
import { Button, IconButton, SectionLabel } from './ui'

const KEYS: readonly GaugeKey[] = ['AP', 'STA', 'IL']

// A face's three gauges stacked small, as the tokens' arcs show them.
function MiniGauges({ gauges }: { gauges: Gauges }){
  return (
    <span className='inline-flex flex-col gap-px shrink-0' title={KEYS.map((k) => `${k} ${gauges[k].label}`).join(' · ')}>
      {KEYS.map((k) => (
        <span key={k} className='block w-6 h-1 rounded-sm bg-raised overflow-hidden'>
          <span className={`block h-full ${SHADE_BG[shadeOf(k, gauges[k].level)]}`} style={{ width: `${gauges[k].fill}%` }} />
        </span>
      ))}
    </span>
  )
}

// The characters the screen plays, by party, to pick one quickly while none
// of them is in play; the board looks at whoever is picked.
export function OwnChips(){
  const { parties, pick } = useOwnChips()
  if (!parties || parties.length === 0) return null
  return (
    <div className='flex flex-col gap-1 max-h-28 overflow-y-auto pr-1 shrink-0' aria-label='your characters'>
      {parties.map((p) => (
        <div key={p.id} className='flex flex-row flex-wrap items-center gap-1 min-w-0'>
          {p.name ? <SectionLabel>{p.name}</SectionLabel> : null}
          {p.cards.map((c) => (
            <Button key={c.id} size='xs' selected={c.isActive} aria-label={`pick ${c.name}`} title={`pick ${c.name}`}
              className={`inline-flex items-center gap-1.5 ${c.dead ? 'opacity-50' : ''}`} onClick={() => pick(c)}>
              {c.isInTurn ? <Play size={10} aria-hidden /> : null}
              <span className='max-w-[9rem] truncate'>{c.name}</span>
              <MiniGauges gauges={c.gauges} />
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}

const rowNote = (r: TargetRow) => [
  r.cells !== null ? `${r.cells} ${r.cells === 1 ? 'cell' : 'cells'}` : null,
  r.heard ? 'out of sight' : null,
  r.elsewhere ? 'another floor' : null,
].filter((s) => s !== null).join(' · ')

function TargetChip({ row, onPick }: { row: TargetRow; onPick: (row: TargetRow) => void }){
  const note = rowNote(row)
  const said = row.aim ? `aim at ${row.name}` : `look at ${row.name}`
  return (
    <Button size='xs' weight={row.aim ? 'solid' : row.heard ? 'ghost' : 'outline'} tone={row.aim ? 'accent' : row.ally ? 'neutral' : 'bad'} aria-label={said} title={said}
      className='inline-flex items-center gap-1.5' onClick={() => onPick(row)}>
      <span className='max-w-[9rem] truncate'>{row.name}</span>
      <MiniGauges gauges={row.gauge} />
      {note ? <span className='text-[10px] text-muted'>{note}</span> : null}
    </Button>
  )
}

// On a turn of one of the screen's characters with nothing open, or while one
// of theirs aims what they declare, whom the one it looks through perceives,
// foes first and the nearest first, the allies folded away unless one may be
// aimed at; a click has the board look at them, and aims at one it may.
export function TargetList(){
  const { rows, pick } = useTargetRows()
  const [allies, setAllies] = useState(false)
  if (!rows || rows.length === 0) return null
  const foes = rows.filter((r) => !r.ally)
  const friends = rows.filter((r) => r.ally && !r.aim)
  const aimed = rows.filter((r) => r.ally && r.aim)
  return (
    <div className='flex flex-col gap-1 shrink-0'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>in sight</SectionLabel>
        {friends.length > 0 ? <Button size='xs' weight='ghost' aria-pressed={allies} onClick={() => setAllies(!allies)}>{allies ? 'hide allies' : `allies (${friends.length})`}</Button> : null}
      </div>
      <div className='flex flex-row flex-wrap gap-1 max-h-28 overflow-y-auto pr-1'>
        {foes.length === 0 ? <span className='text-xs text-muted'>no foe perceived</span> : null}
        {foes.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />)}
        {aimed.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />)}
        {allies ? friends.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />) : null}
      </div>
    </div>
  )
}

const RIM: Record<FaceCard['side'], string> = { ally: 'border-good', enemy: 'border-bad' }
const DOT: Record<FaceCard['side'], string> = { ally: 'bg-good', enemy: 'bg-bad' }

const faceNote = (f: FaceCard) => [
  f.name,
  f.isInTurn ? 'in turn' : null,
  f.role && f.role !== 'none' ? f.role : null,
  f.dead ? 'dead' : null,
  f.surrendered ? 'surrendered' : null,
  f.usedSurge ? `${f.usedSurge} surge used` : null,
  f.holding ? `holding ${f.holding.label}` : null,
].filter((s) => s !== null).join(' · ')

// A face as its token is drawn on the board, its rim the side it is on, its
// gauges beside it and its name under it.
function Face({ face, picked, onPick }: { face: FaceCard, picked: boolean, onPick: () => void }){
  const lit = face.isActive || picked ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : ''
  return (
    <button type='button' aria-label={face.name} title={faceNote(face)} onClick={onPick}
      className={`flex flex-col items-center gap-0.5 w-full shrink-0 cursor-pointer rounded py-1 ${face.isInTurn ? 'bg-good/15 border border-good' : 'border border-transparent'} ${face.dead ? 'opacity-40' : ''}`}>
      {face.isInTurn ? <span className='inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-good'><Play size={9} aria-hidden className='fill-current' />in turn</span> : null}
      <span className='flex flex-row items-center gap-1.5'>
        <span className={`flex items-center justify-center w-9 h-9 rounded-full border-2 bg-surface text-xs ${RIM[face.side]} ${lit} ${face.isInTurn ? 'shadow-[0_0_10px_2px] shadow-good/70' : ''} ${face.targetable ? 'animate-pulse' : ''}`}>
          {face.name.slice(0, 2)}
        </span>
        <MiniGauges gauges={face.gauges} />
      </span>
      <span className={`max-w-full truncate text-[10px] ${face.isInTurn ? 'text-good font-semibold' : face.isActive ? 'text-accent' : 'text-muted'}`}>{face.name}</span>
    </button>
  )
}

// Everyone the screen knows in the fight, a face each, down the left of the
// board, party by party: a click picks one, or aims at them. Open to begin
// with, and folded to a thin edge at will.
export function FacesColumn(){
  const { parties, away, picked, pick } = useFaceColumn()
  const [open, setOpen] = useState(true)
  if (!open) return (
    <nav aria-label='faces' className='w-7 shrink-0 border-r border-line'>
      <button type='button' aria-label='show the faces' title='show the characters in the fight' onClick={() => setOpen(true)}
        className='w-full h-full flex flex-col items-center gap-2 py-2 cursor-pointer text-muted hover:text-fg hover:bg-raised'>
        <ChevronRight size={14} aria-hidden />
        <span className='text-[10px] uppercase tracking-wider [writing-mode:vertical-rl]'>characters</span>
        {parties.map((p) => (
          <span key={p.id} className='flex flex-col items-center gap-1 pt-1'>
            {p.cards.map((f) => <span key={f.id} className={`block w-2.5 h-2.5 rounded-full ${DOT[f.side]} ${f.isActive ? 'ring-2 ring-accent' : ''} ${f.dead ? 'opacity-40' : ''}`} />)}
          </span>
        ))}
      </button>
    </nav>
  )
  return (
    <nav aria-label='faces' className='w-24 shrink-0 flex flex-col items-center gap-2 overflow-y-auto py-1 px-1 border-r border-line'>
      <IconButton icon={ChevronLeft} className='self-end' aria-label='hide the faces' title='hide the faces' onClick={() => setOpen(false)} />
      {parties.map((p, i) => (
        <div key={p.id} className={`flex flex-col items-center gap-2 w-full ${i > 0 ? 'pt-2 border-t border-line' : ''}`} title={p.name || undefined}>
          {p.cards.map((f) => <Face key={f.id} face={f} picked={picked.includes(f.id)} onPick={() => pick(f.id)} />)}
        </div>
      ))}
      {away.map((f) => (
        <span key={f.id} title={`${f.name}: none of your characters senses them now`} className='flex flex-col items-center gap-0.5 w-full opacity-60'>
          <span className='flex items-center justify-center w-9 h-9 rounded-full border-2 border-dashed border-line text-xs text-muted'>{f.name.slice(0, 2)}</span>
          <span className='max-w-full truncate text-[10px] text-muted'>{f.name}</span>
        </span>
      ))}
    </nav>
  )
}
