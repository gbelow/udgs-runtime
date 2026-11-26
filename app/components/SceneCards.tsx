'use client'
import type { ReactNode } from 'react'
import { useSceneCards } from '../hooks/useCombatState'
import type { SceneCard } from '../domain/scene/projections/cards'
import type { Gauge } from '../domain/character/lenses/bars'
import { SHADE_BG, shadeOf, type GaugeKey } from '../gaugeShades'

// The fight with no board: everyone is in reach, so the middle shows each
// character as a card, by party. A click aims the open action at a target,
// and selects the character otherwise.
export function SceneCards(){
  const { parties, pick, picked } = useSceneCards()
  if (parties.length === 0) return <span className='text-xs text-muted'>nobody in the fight</span>

  return (
    <div className='flex flex-col gap-3'>
      {parties.map((party) => (
        <div key={party.id} className='flex flex-col gap-1.5'>
          {party.name ? <span className='text-[10px] uppercase tracking-wide text-muted'>{party.name}</span> : null}
          <div className='flex flex-row flex-wrap gap-2'>
            {party.cards.map((card) => <Card key={card.id} card={card} picked={picked.includes(card.id)} onClick={() => pick(card)} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// A resource as its face shows it: a small bar filled and shaded by its
// gauge, with the number beside it on a sheet the viewer plays.
function Left({ name, gauge, value }: { name: GaugeKey, gauge: Gauge, value: number | null }){
  return (
    <span className='inline-flex flex-row items-center gap-1'>
      {name}
      <span title={gauge.label} aria-label={`${name} ${gauge.label}`} className='inline-block w-8 h-1.5 rounded-sm bg-raised border border-line overflow-hidden'>
        <span className={`block h-full ${SHADE_BG[shadeOf(name, gauge.level)]}`} style={{ width: `${gauge.fill}%` }} />
      </span>
      {value !== null ? <span className='font-mono text-fg'>{value}</span> : null}
    </span>
  )
}

// One character's card; a click picks them, and what is passed in sits under
// it.
export function Card({ card, picked = false, onClick, children }: { card: SceneCard, picked?: boolean, onClick: () => void, children?: ReactNode }){
  const frame = picked ? 'border-accent bg-accent/20' : card.targetable ? 'border-bad animate-pulse' : card.isActive ? 'border-accent bg-accent/10' : 'border-line hover:border-muted'
  return (
    <div
      className={`w-52 rounded border flex flex-col bg-surface cursor-pointer ${frame} ${card.dead ? 'opacity-50' : ''}`}
      onClick={(e) => {
        const control = (e.target as HTMLElement).closest('button, input, select, a')
        if (control && control !== e.currentTarget.firstElementChild) return
        onClick()
      }}
    >
      <button type='button' aria-label={`card ${card.name}`} className='text-left p-2 flex flex-col gap-1'>
        <div className='flex flex-row items-baseline gap-1.5'>
          <span className='font-medium truncate'>{card.name}</span>
          {card.isInTurn ? <span className='text-[10px] text-accent'>in turn</span> : null}
          {card.role && card.role !== 'none' ? <span className='ml-auto text-[10px] text-muted'>{card.role}</span> : null}
        </div>
        <div className='flex flex-row flex-wrap gap-x-2.5 text-xs text-muted'>
          <Left name='AP' gauge={card.gauges.AP} value={card.AP} />
          <Left name='STA' gauge={card.gauges.STA} value={card.STA} />
          <Left name='IL' gauge={card.gauges.IL} value={card.IL} />
          {card.bleed ? <span className='text-bad'>bleed <span className='font-mono'>{card.bleed}</span></span> : null}
          {card.burning ? <span className='text-bad'>burning <span className='font-mono'>{card.burning}</span></span> : null}
        </div>
        {card.dead || card.surrendered || card.usedSurge || card.holding ? (
          <div className='flex flex-row flex-wrap gap-x-2 text-[10px] text-muted'>
            {card.dead ? <span className='text-bad'>dead</span> : null}
            {card.surrendered ? <span>surrendered</span> : null}
            {card.usedSurge ? <span>✓ {card.usedSurge} surge</span> : null}
            {card.holding ? <span>holding {card.holding.label} ({card.holding.AP} AP)</span> : null}
          </div>
        ) : null}
        {card.conditions.length > 0 ? (
          <div className='flex flex-row flex-wrap gap-1'>
            {card.conditions.map((k) => <span key={k} className='text-[10px] px-1 rounded border border-bad/50 text-bad'>{k}</span>)}
          </div>
        ) : null}
      </button>
      {children ? <div className='px-2 pb-2 flex flex-col gap-1 text-xs'>{children}</div> : null}
    </div>
  )
}
