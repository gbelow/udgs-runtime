'use client'
import { Play, SkipForward, Trophy } from 'lucide-react'
import { useTurnBanner, type ContestFor } from '../hooks/useTurnBanner'

const WENT_TEXT: Record<ContestFor['went'], string> = { won: 'text-good', lost: 'text-bad', watched: 'text-fg' }

// Whose turn it is, across the top of the scene, flashed as a turn begins and
// as one ends, and how the contest for it went.
export function TurnBanner(){
  const { view, own, ended, contest } = useTurnBanner()
  if (!view) return null
  const { holder, turn } = view
  const look = !holder ? 'border-dashed border-line text-muted' : own ? 'border-accent bg-accent/15 text-accent' : 'border-bad/60 bg-bad/10 text-fg'
  return (
    <div key={holder ? `${turn}:${holder.id}:${contest ? 'contested' : ''}` : `none:${turn}`} role='status' aria-label='whose turn' className={`animate-flash shrink-0 flex flex-row flex-wrap items-center gap-2 rounded border px-3 py-1 mb-1 ${look}`}>
      {holder ? <Play size={14} aria-hidden /> : ended ? <SkipForward size={14} aria-hidden /> : null}
      {holder ? <span className='text-sm font-semibold'>{holder.name}&apos;s {holder.flees ? 'flight' : 'turn'}</span> : null}
      {holder ? <span className='text-xs text-muted'>{own ? 'yours to play' : 'not yours to play'}</span> : null}
      {holder && contest ? (
        <span role='group' aria-label='contest result' className='basis-full flex flex-row flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${WENT_TEXT[contest.went]}`}><Trophy size={14} aria-hidden />{contest.title}</span>
          {contest.rolls.map((r) => (
            <span key={r.id} title={r.detail} className={`rounded border px-1.5 text-xs ${r.won ? 'border-current text-fg font-semibold' : 'border-line text-muted'}`}>{r.name} <span className='font-mono'>{r.score}</span></span>
          ))}
        </span>
      ) : null}
      {!holder && ended ? <span className='text-sm font-semibold text-fg'>{ended}&apos;s turn ended</span> : null}
      {!holder ? <span className='text-xs'>nobody is in turn: pick a character and start theirs</span> : null}
    </div>
  )
}
