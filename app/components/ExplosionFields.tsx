'use client'
import type { ExplosionDraftState } from '../hooks/useBoard'
import { NumberInput, SectionLabel, selectClass } from './ui'

// The form that describes an explosion: set off at a cell, or written into an
// object as its charge.
export function ExplosionFields({ draft: { explosion, setExplosion, explosionOptions } }: { draft: ExplosionDraftState }){
  return (
    <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center text-xs'>
      <SectionLabel>explosion</SectionLabel>
      <select className={selectClass} aria-label='explosion effect' value={explosion.effect} onChange={(e) => setExplosion({ ...explosion, effect: e.target.value as typeof explosion.effect })}>
        {explosionOptions.effects.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      {explosion.effect === 'damage' ? (<>
        <NumberInput className='w-10' aria-label='explosion damage' value={explosion.amount} onChange={(e) => setExplosion({ ...explosion, amount: Number(e.target.value) })} />
        <select className={selectClass} aria-label='explosion damage kind' value={explosion.damageKind} onChange={(e) => setExplosion({ ...explosion, damageKind: e.target.value as typeof explosion.damageKind })}>
          {explosionOptions.damageKinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </>) : null}
      {explosion.effect === 'affliction' ? (
        <select className={selectClass} aria-label='explosion affliction' value={explosion.affliction} onChange={(e) => setExplosion({ ...explosion, affliction: e.target.value as typeof explosion.affliction })}>
          {explosionOptions.afflictions.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      ) : null}
      {explosion.effect === 'cost' ? (<>
        AP <NumberInput className='w-10' aria-label='explosion AP lost' value={explosion.AP} onChange={(e) => setExplosion({ ...explosion, AP: Number(e.target.value) })} />
        STA <NumberInput className='w-10' aria-label='explosion STA lost' value={explosion.STA} onChange={(e) => setExplosion({ ...explosion, STA: Number(e.target.value) })} />
      </>) : null}
      DL <NumberInput className='w-10' aria-label='explosion DL' value={explosion.DL} onChange={(e) => setExplosion({ ...explosion, DL: Number(e.target.value) })} />
      radius <NumberInput className='w-10' aria-label='explosion radius' min={0} value={explosion.radius} onChange={(e) => setExplosion({ ...explosion, radius: Number(e.target.value) })} /> m
    </div>
  )
}
