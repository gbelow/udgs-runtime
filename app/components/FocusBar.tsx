'use client'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import type { Gauges } from '../domain/character/lenses/bars'
import type { FaceCard } from '../domain/scene/projections/cards'
import { useFaceColumn } from '../hooks/useFocusBar'
import { SHADE_BG, shadeOf, type GaugeKey } from '../gaugeShades'
import { IconButton } from './ui'

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
