'use client'
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Crosshair, EyeOff, CornerRightUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SectionLabel } from './ui'
import { useChaseTrack } from '../hooks/useChase'
import type { ChaseSide } from '../domain/lists'
import type { TrackGap, TrackIntent, TrackParty } from '../domain/scene/projections/chase'

const TEAM_LOOK: Record<ChaseSide, string> = {
  pursuers: 'border-bad',
  quarry: 'border-accent',
}

const TOKEN_LOOK: Record<ChaseSide, string> = {
  pursuers: 'bg-bad/20 text-bad',
  quarry: 'bg-accent/20 text-accent',
}

// The length of a link by its tier, each a little longer than the last.
const GAP_WIDTH: Record<number, string> = { 1: 'w-20', 2: 'w-24', 3: 'w-28', 4: 'w-32' }

// The chaser stands on the left, so closing in points right for it and
// left for the one it chases.
const CHASER_ICON: Record<NonNullable<TrackIntent>, LucideIcon> = { close: ArrowRight, open: ArrowLeft, shoot: Crosshair, hide: EyeOff }
const CHASED_ICON: Record<NonNullable<TrackIntent>, LucideIcon> = { close: ArrowLeft, open: ArrowRight, shoot: Crosshair, hide: EyeOff }

const INTENT_TEXT: Record<NonNullable<TrackIntent>, string> = { close: 'closes in', open: 'pulls away', shoot: 'shoots', hide: 'hides' }

// combat.tex "Group chases": the chain drawn as lanes, tail on the left and
// head on the right, every party with its members and every link with its
// tier and what each end declared. A party clicked shows every other's
// distance from it. With `preview`, the chain the parties' choices would
// start.
export function ChaseTrack({ preview = false }: { preview?: boolean }){
  const track = useChaseTrack(preview)
  const [picked, setPicked] = useState<string | null>(null)
  if (!track) return null
  const pick = (id: string) => setPicked(picked === id ? null : id)

  return(
    <div className='flex flex-col gap-2 rounded border border-line bg-surface p-2'>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
        <SectionLabel>{preview ? 'The chase these choices start' : 'Chase track'}</SectionLabel>
        <span className='inline-flex items-center gap-1'><span className='size-2.5 rounded-full border-2 border-bad' />pursuers</span>
        <span className='inline-flex items-center gap-1'><span className='size-2.5 rounded-full border-2 border-accent' />quarry</span>
        {preview ? null : <span>{track.resolved ? 'resolved: arrows show the way each link went' : 'declared: faint arrows show what each end means to do'}</span>}
        <span>click a party to read distances from it</span>
      </div>
      <div className='flex flex-col gap-3 overflow-x-auto pb-1'>
        {track.lanes.map((lane, i) => (
          <div key={i} className='flex flex-row items-center'>
            {lane.map((item, j) =>
              item.kind === 'party' ? <PartyBlock key={item.party.id} party={item.party} picked={picked} onPick={() => pick(item.party.id)} />
              : item.kind === 'gap' ? <Gap key={`gap-${j}`} gap={item.gap} resolved={track.resolved} />
              : <span key={`join-${item.id}`} className='inline-flex items-center gap-1 text-xs text-muted whitespace-nowrap'><CornerRightUp size={12} aria-hidden />joins {item.name}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PartyBlock({ party, picked, onPick }: { party: TrackParty; picked: string | null; onPick: () => void }){
  const from = picked && picked !== party.id ? party.tiers[picked] : null
  const badges = [party.stage, party.hiding ? 'hiding' : null, party.fighting ? 'fighting first' : null].filter((b) => b !== null)

  return(
    <button type='button' aria-label={`track ${party.name}`} aria-pressed={picked === party.id} onClick={onPick}
      className={`shrink-0 flex flex-col gap-1 rounded-md border-2 bg-raised px-2 py-1.5 text-left cursor-pointer transition-opacity
        ${TEAM_LOOK[party.team]} ${picked === party.id ? 'ring-2 ring-fg/40' : ''} ${party.hiding ? 'opacity-60' : ''}`}>
      <span className='flex flex-row gap-2 items-baseline justify-between'>
        <span className='text-xs font-semibold whitespace-nowrap'>{party.name}</span>
        <span className='text-[10px] uppercase tracking-wide text-muted'>{party.team}</span>
      </span>
      <span className='grid grid-cols-3 gap-1'>
        {party.tokens.map((t) => (
          <span key={t.id} title={[t.name, ...t.marks].join(', ')}
            className={`inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold ${TOKEN_LOOK[party.team]} ${t.caught ? 'ring-2 ring-bad' : t.marks.length ? 'ring-1 ring-muted' : ''}`}>
            {t.short}
          </span>
        ))}
        {party.more > 0 ? <span className='inline-flex size-6 items-center justify-center rounded-full border border-line text-[10px] text-muted'>+{party.more}</span> : null}
      </span>
      {badges.length ? <span className='flex flex-row flex-wrap gap-1'>{badges.map((b) => <span key={b} className='rounded border border-line px-1 text-[10px] text-muted'>{b}</span>)}</span> : null}
      {from ? <span className='rounded bg-fg/10 px-1 text-[10px] text-fg'>{from} from the picked party</span> : null}
    </button>
  )
}

function Gap({ gap, resolved }: { gap: TrackGap; resolved: boolean }){
  const line = gap.enemy ? 'border-t-2 border-fg' : 'border-t border-muted'
  return(
    <div className={`shrink-0 flex flex-col items-center gap-0.5 px-1 ${GAP_WIDTH[gap.step]}`}>
      <span className='text-[10px] text-muted whitespace-nowrap'>
        {gap.was ? <>{gap.was} → </> : null}<span className='text-fg font-medium'>{gap.tier}</span>{gap.frozen ? ' (frozen)' : ''}
      </span>
      <span className={`w-full ${line} ${gap.frozen ? 'border-dashed' : ''}`} />
      <span className={`flex w-full flex-row justify-between ${resolved ? '' : 'opacity-50'}`}>
        <End intent={gap.chaser} icons={CHASER_ICON} who='chaser' won={gap.winner === 'chaser'} />
        <End intent={gap.chased} icons={CHASED_ICON} who='chased' won={gap.winner === 'chased'} />
      </span>
    </div>
  )
}

function End({ intent, icons, who, won }: { intent: TrackIntent; icons: Record<NonNullable<TrackIntent>, LucideIcon>; who: string; won: boolean }){
  if (!intent) return <span className='size-4' />
  const Icon = icons[intent]
  return (
    <span title={`${who} ${INTENT_TEXT[intent]}${won ? ', won the contest' : ''}`} className={`inline-flex ${won ? 'text-good' : 'text-fg'}`}>
      <Icon size={16} aria-hidden />
    </span>
  )
}
