'use client'
import { Play, SkipForward } from 'lucide-react'
import { useTurnBanner } from '../hooks/useTurnBanner'
import { ContestBar } from './ContestBar'

// Whose turn it is, across the top of the scene, flashed as a turn begins and
// as one ends.
export function TurnBanner(){
  const { view, own, ended } = useTurnBanner()
  if (!view) return null
  const { holder, turn } = view
  const look = !holder ? 'border-dashed border-line text-muted' : own ? 'border-accent bg-accent/15 text-accent' : 'border-bad/60 bg-bad/10 text-fg'
  return (
    <>
    <div key={holder ? `${turn}:${holder.id}` : `none:${turn}`} role='status' aria-label='whose turn' className={`animate-flash shrink-0 flex flex-row flex-wrap items-center gap-2 rounded border px-3 py-1 mb-1 ${look}`}>
      {holder ? <Play size={14} aria-hidden /> : ended ? <SkipForward size={14} aria-hidden /> : null}
      {holder ? <span className='text-sm font-semibold'>{holder.name}&apos;s {holder.flees ? 'flight' : 'turn'}</span> : null}
      {holder ? <span className='text-xs text-muted'>{own ? 'yours to play' : 'not yours to play'}</span> : null}
      {!holder && ended ? <span className='text-sm font-semibold text-fg'>{ended}&apos;s turn ended</span> : null}
      {!holder ? <span className='text-xs'>nobody is in turn: pick a character and start theirs</span> : null}
    </div>
    <ContestBar />
    </>
  )
}
