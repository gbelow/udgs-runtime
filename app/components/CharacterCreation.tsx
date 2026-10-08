'use client'

import { useState } from 'react'
import { Button, Panel, Row, SectionLabel, selectClass } from './ui'
import { useCreation } from '../hooks/useCreation'
import { PRIORITIES } from '../domain/types'
import { LIMIT_STRESS_ACTIONS, TEMPERAMENT_CONVICTIONS, WORLDVIEW_CONVICTIONS, type LimitStressAction } from '../domain/lists'
import type { CreationPrice, CreationRow } from '../domain/character/lenses/creation'

// creating.tex "Character Creation": the race, the priorities and what is
// bought from each pool. Everything can be changed in any order; the
// character is made once every pool fits.
export function CharacterCreation() {
  const { view } = useCreation()
  return (
    <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3 text-left text-sm'>
      <div className='md:col-span-4 flex flex-col gap-3'>
        <CreationHeader />
        <Priorities />
        <Choices />
        <Pools />
        <Problems />
      </div>
      <div className='md:col-span-4 flex flex-col gap-3'>
        {view.groups.map((group) => <TrainableGroup key={group.label} label={group.label} rows={group.rows} />)}
        <Knowledges />
      </div>
      <div className='md:col-span-4 flex flex-col gap-3'>
        <Abilities />
      </div>
    </div>
  )
}

function CreationHeader() {
  const { view, races, chooseRace, finish, restart } = useCreation()
  return (
    <div className='flex flex-row flex-wrap items-center gap-2'>
      <select aria-label='race' className={selectClass} value={view.race ?? ''} onChange={(e) => chooseRace(e.target.value)}>
        <option value=''>— race —</option>
        {races.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <Button variant='primary' disabled={view.problems.length > 0} onClick={finish}>create</Button>
      <Button variant='ghost' onClick={restart}>start over</Button>
    </div>
  )
}

// Step 2: each focus against the five priorities; picking one takes it from
// the focus that held it.
function Priorities() {
  const { view, setPriority } = useCreation()
  return (
    <Panel title='Priorities' meta={`${view.gold} GP`}>
      {view.priorities.map(({ focus, priority }) => (
        <div key={focus} className='flex flex-row items-center gap-1'>
          <span className='w-14 text-xs'>{focus}</span>
          {PRIORITIES.map((p) => (
            <Button key={p} size='xs' active={p === priority} variant={p === priority ? 'primary' : 'default'} onClick={() => setPriority(focus, p)}>{p}</Button>
          ))}
        </div>
      ))}
    </Panel>
  )
}

// The choices the book requires of every character: its convictions and its
// limit stress action.
function Choices() {
  const { view, chooseConviction, chooseLimitStress } = useCreation()
  return (
    <Panel title='Spirit'>
      <ChoiceSelect label='temperament' value={view.temperament} options={Object.values(TEMPERAMENT_CONVICTIONS).map((c) => c.name)} onChange={(name) => chooseConviction('conviction1', name)} />
      <ChoiceSelect label='worldview' value={view.worldview} options={Object.values(WORLDVIEW_CONVICTIONS).map((c) => c.name)} onChange={(name) => chooseConviction('conviction2', name)} />
      <ChoiceSelect label='limit stress' value={view.limitStress ?? ''} options={[...LIMIT_STRESS_ACTIONS]} onChange={(action) => chooseLimitStress((action || null) as LimitStressAction | null)} />
    </Panel>
  )
}

function ChoiceSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className='flex flex-row items-center gap-2'>
      <span className='w-24 text-xs'>{label}</span>
      <select aria-label={label} className={selectClass} value={options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value=''>—</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  )
}

function Pools() {
  const { view } = useCreation()
  return (
    <Panel title='Budget'>
      {view.pools.map(({ pool, budget, spent, over }) => (
        <div key={pool} className='flex flex-row items-baseline gap-2 text-xs'>
          <span className='w-12'>{pool}</span>
          <span className={`font-mono ${over ? 'text-bad' : ''}`}>{spent} / {budget}</span>
        </div>
      ))}
    </Panel>
  )
}

function Problems() {
  const { view } = useCreation()
  if (!view.problems.length) return null
  return (
    <div className='flex flex-col gap-0.5 text-xs text-bad'>
      {view.problems.map((problem) => <span key={problem}>{problem}</span>)}
    </div>
  )
}

const priceLabel = (price: CreationPrice): string =>
  price === null ? '—' : price.pool === null ? 'free' : `${price.amount} ${price.pool}`

// One thing that can be bought: its level now, − to give a level back, + to
// buy the next at the price shown.
function BuyRow({ name, value, bought, next, onBuy }: { name: string; value: number; bought: number; next: CreationPrice; onBuy: (change: 1 | -1) => void }) {
  return (
    <Row dimmed={bought === 0}>
      <span className='w-32'>{name}</span>
      <span className='w-6 text-center font-mono'>{value}</span>
      <Button size='xs' disabled={bought === 0} onClick={() => onBuy(-1)}>−</Button>
      <Button size='xs' disabled={next === null} onClick={() => onBuy(1)}>+</Button>
      <span className='ml-auto text-muted'>{priceLabel(next)}</span>
    </Row>
  )
}

function TrainableGroup({ label, rows }: { label: string; rows: CreationRow[] }) {
  const { buyLevel } = useCreation()
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>{label}</SectionLabel>
      {rows.map((row) => <BuyRow {...row} key={row.key} onBuy={(change) => buyLevel(row.key, change)} />)}
    </div>
  )
}

function Knowledges() {
  const { view, buyKnowledge } = useCreation()
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Knowledges</SectionLabel>
      {view.knowledges.map((row) => <BuyRow key={row.name} {...row} onBuy={(change) => buyKnowledge(row.name, change)} />)}
    </div>
  )
}

function Abilities() {
  const { view, buyStage } = useCreation()
  const [picked, setPicked] = useState('')
  const add = () => {
    const option = view.abilityOptions.find((o) => o.family === picked)
    if (option) buyStage(option.family, 1)
    setPicked('')
  }
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Abilities</SectionLabel>
      <div className='flex flex-row gap-2 items-center'>
        <select aria-label='ability' className={selectClass} value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value=''>— ability —</option>
          {view.abilityOptions.map((o) => <option key={o.family} value={o.family}>{o.name} ({priceLabel(o.next)})</option>)}
        </select>
        <Button size='xs' disabled={!picked} onClick={add}>add</Button>
      </div>
      {view.abilities.map((row) => <BuyRow key={row.family} {...row} onBuy={(change) => buyStage(row.family, change)} />)}
    </div>
  )
}
