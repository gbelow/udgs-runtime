'use client'
import type { PrepareView } from '../domain/combat/projections/prepare'
import type { ActionDraft } from '../domain/combat/types'
import { Button, SectionLabel } from './ui'

const toggle = (active: boolean) => ({ variant: active ? 'primary' as const : 'default' as const, className: active ? 'bg-accent/15' : '' })

const NO_MAIN = { weaponKey: '', attack: '', variant: '', ammoId: '', key: '', quicken: false, extend: 0, movement: 'basic' } as const

// combat.tex "Preparing a reaction": what is prepared is declared first, then
// what it waits for is picked from what that action can wait for.
export function Preparation({ view, onAmend, onSpell, onExtend }: {
  view: PrepareView
  onAmend: (fields: Partial<ActionDraft>) => void
  onSpell: (key: string, quicken: boolean) => void
  onExtend: (delta: 1 | -1) => void
}){
  const event = view.events.find((e) => e.selected)?.event ?? null
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>prepare</SectionLabel>
        {view.mains.map((m) =>
          <Button key={m.kind} size='xs' {...toggle(m.selected)} disabled={!m.available} title={m.reason ?? undefined}
            onClick={() => onAmend({ main: m.kind, ...NO_MAIN, trigger: null })}>{m.kind}</Button>)}
        <Button size='xs' {...toggle(view.moves)} title='up to 2 AP of movement, which may be skipped when it is done' onClick={() => onAmend({ moves: !view.moves })}>+2 AP of movement</Button>
      </div>

      {view.attacks.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>with</SectionLabel>
          {view.attacks.map((s) =>
            <Button key={`${s.weaponKey}:${s.attack}:${s.variant}`} size='xs' {...toggle(s.selected)}
              onClick={() => onAmend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant })}>
              {s.weapon} {s.attack} {s.variant}{s.distance !== null ? <span className='ml-1 font-mono text-muted'>-{s.distance}/10m</span> : null}
            </Button>)}
        </div>
      ) : null}
      {view.defenses.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>defending with</SectionLabel>
          {view.defenses.map((d) =>
            <Button key={`${d.weaponKey}:${d.attack}`} size='xs' {...toggle(d.selected)} onClick={() => onAmend({ weaponKey: d.weaponKey, attack: d.attack })}>{d.weapon} {d.attack}</Button>)}
        </div>
      ) : null}
      {view.ammo.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>loaded with</SectionLabel>
          {view.ammo.map((a) =>
            <Button key={a.itemId} size='xs' variant='default' onClick={() => onAmend({ ammoId: a.itemId })}>{a.name} <span className='font-mono text-muted'>×{a.amount}</span></Button>)}
        </div>
      ) : null}
      {view.spells.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>spell</SectionLabel>
          {view.spells.map((s) => (
            <span key={s.key} className='inline-flex items-stretch'>
              <Button size='xs' className={s.quickenable ? 'rounded-r-none' : ''} disabled={!s.castable} title={s.reason ?? undefined} onClick={() => onSpell(s.key, false)}>{s.name}</Button>
              {s.quickenable ? <Button size='xs' className='rounded-l-none border-l-0' onClick={() => onSpell(s.key, true)}>quicken</Button> : null}
            </span>
          ))}
          <Button size='xs' aria-label='extend less' onClick={() => onExtend(-1)}>−</Button>
          <Button size='xs' aria-label='extend more' onClick={() => onExtend(1)}>+</Button>
        </div>
      ) : null}
      {view.movements.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>movement</SectionLabel>
          {view.movements.map((m) =>
            <Button key={m.kind} size='xs' disabled={!m.available} title={m.reason ?? undefined} onClick={() => onAmend({ movement: m.kind })}>{m.kind}</Button>)}
        </div>
      ) : null}

      {view.zone !== null ? (
        <>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            <SectionLabel>when</SectionLabel>
            {view.events.map((e) =>
              <Button key={e.event} size='xs' {...toggle(e.selected)} onClick={() => onAmend({ trigger: { event: e.event, who: view.who.find((w) => w.selected)?.id ?? null } })}>{e.label}</Button>)}
          </div>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            <SectionLabel>who</SectionLabel>
            {view.who.map((w) =>
              <Button key={w.id ?? 'anyone'} size='xs' {...toggle(w.selected)} disabled={event === null} title={event === null ? 'pick what it waits for first' : undefined}
                onClick={() => event && onAmend({ trigger: { event, who: w.id } })}>{w.name}</Button>)}
          </div>
        </>
      ) : null}
      {!view.complete ? <span className='text-xs text-muted'>{view.zone === null ? 'pick what to prepare' : 'pick what it waits for'}</span> : null}
    </div>
  )
}
