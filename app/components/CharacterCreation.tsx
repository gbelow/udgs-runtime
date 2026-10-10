'use client'

import { Button, CatalogList, Panel, Row, SectionLabel, TextInput, selectClass } from './ui'
import { useCreation } from '../hooks/useCreation'
import { AbilityFamilyRow, LockedLabel } from './AbilitySelector'
import { SpellCatalogEntry } from './SpellSelector'
import { ItemSelector } from './ItemSelector'
import { ArmorPanel } from './ArmorPanel'
import { HandsPanel } from './HandsPanel'
import { WeaponPanel } from './WeaponPanel'
import { ContainerPanel } from './ContainerPanel'
import { PRIORITIES, SpellMethodSchema } from '../domain/types'
import { LIMIT_STRESS_ACTIONS, TEMPERAMENT_CONVICTIONS, WORLDVIEW_CONVICTIONS, type LimitStressAction } from '../domain/lists'
import type { CreationPrice, CreationRow } from '../domain/character/lenses/creation'
import type { Term } from '../domain/character/rules/terms'

// creating.tex "Character Creation": the race, the priorities and what is
// bought from each pool. Everything can be changed in any order; the
// character is made once every pool fits.
export function CharacterCreation() {
  const { view } = useCreation()
  return (
    <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3 text-left text-sm'>
      <div className='md:col-span-4 flex flex-col gap-3'>
        <CreationHeader />
        <RacePreset />
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
        <Magic />
      </div>
      <Gear />
    </div>
  )
}

// creating.tex "Character Creation", Step 3: the wealth focus's gold buys
// anything but training. Pick from the catalog, then a slot or a hand; the
// budget above counts the price of everything carried.
function Gear() {
  return (
    <div className='md:col-span-12 grid grid-cols-1 md:grid-cols-12 gap-4'>
      <div className='md:col-span-4 flex flex-col gap-1'>
        <div className='flex flex-col gap-0.5 sticky top-0 z-10 bg-surface py-1'>
          <SectionLabel>Gear</SectionLabel>
          <WealthLine />
        </div>
        <div className='flex flex-col rounded border border-line p-1'>
          <ItemSelector />
        </div>
      </div>
      <div className='md:col-span-8 flex flex-col gap-3 text-sm'>
        <ArmorPanel />
        <HandsPanel />
        <WeaponPanel />
        <ContainerPanel />
      </div>
    </div>
  )
}

function CreationHeader() {
  const { view, races, rename, chooseRace, finish, restart } = useCreation()
  return (
    <div className='flex flex-row flex-wrap items-center gap-2'>
      <TextInput aria-label='character name' placeholder='name' className='grow text-sm' value={view.name} onChange={(e) => rename(e.target.value)} />
      <select aria-label='race' className={selectClass} value={view.race?.name ?? ''} onChange={(e) => chooseRace(e.target.value)}>
        <option value=''>— race —</option>
        {races.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <Button variant='primary' disabled={view.problems.length > 0} onClick={finish}>create</Button>
      <Button variant='ghost' onClick={restart}>start over</Button>
    </div>
  )
}

const signed = (value: number): string => (value < 0 ? `${value}` : `+${value}`)

// Step 1: the race the character was started from, kept in sight with what it
// gave.
function RacePreset() {
  const { view } = useCreation()
  const race = view.race
  return (
    <Panel title='Race' meta={race ? race.name : 'none'}>
      {race ? (
        <>
          <div className='flex flex-row flex-wrap gap-2 text-xs'>
            {race.bonuses.length ? race.bonuses.map((b) => <span key={b.label} className='font-mono'>{b.label} {signed(b.value)}</span>) : <span className='text-muted'>no bonuses</span>}
          </div>
          {race.abilities.length ? <span className='text-xs text-muted'>{race.abilities.join(', ')}</span> : null}
        </>
      ) : <span className='text-xs text-muted'>no race chosen</span>}
    </Panel>
  )
}

// Step 2: each focus against the five priorities; picking one takes it from
// the focus that held it.
function Priorities() {
  const { view, setPriority } = useCreation()
  return (
    <Panel title='Priorities' meta={`${view.gold} GP`}>
      {view.priorities.map(({ focus, priority, talent }) => (
        <div key={focus} className='flex flex-row items-center gap-1'>
          <span className='w-14 text-xs'>{focus}</span>
          {PRIORITIES.map((p) => (
            <Button key={p} size='xs' active={p === priority} variant={p === priority ? 'primary' : 'default'} onClick={() => setPriority(focus, p)}>{p}</Button>
          ))}
          {talent ? (
            <span className='ml-auto text-xs font-mono'>
              {talent.total}
              <span className='text-muted'> = {talent.terms.map((t) => `${t.value} ${t.label}`).join(' + ') || '0'}</span>
            </span>
          ) : null}
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
      <WealthLine />
    </Panel>
  )
}

// The gold against the gear carried: spent of the budget, and what is left.
function WealthLine() {
  const { view } = useCreation()
  const wealth = view.wealth
  if (!wealth) return null
  const bad = wealth.over || wealth.overSpared
  return (
    <div className='flex flex-row flex-wrap items-baseline gap-x-2 text-xs'>
      <span className='w-12'>gold</span>
      <span className={`font-mono ${bad ? 'text-bad' : ''}`}>{wealth.spent} / {wealth.budget}</span>
      <span className={bad ? 'text-bad' : 'text-muted'}>{wealth.left} {wealth.over ? 'over' : 'left'}</span>
      {wealth.over ? null : <span className='text-muted'>· keeps {wealth.kept} (up to {wealth.spared}), the rest is lost</span>}
      {wealth.keptHasNowhere ? <span className='text-bad'>· no container to carry it: put one on or it is lost</span> : null}
    </div>
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
function BuyRow({ name, value, bought, next, terms = [], onBuy }: { name: string; value: number; bought: number; next: CreationPrice; terms?: Term[]; onBuy: (change: 1 | -1) => void }) {
  return (
    <Row dimmed={bought === 0}>
      <span className='w-32'>
        {name}
        {terms.length ? <span className='block text-[10px] text-muted'>{terms.map((t) => `${t.label} ${t.value}`).join(' + ')}</span> : null}
      </span>
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

// abilities.tex: the catalog browsed by category with every family's
// stages and what they do, a family that can be bought now added from it;
// under it the families held, the race's stages locked.
function Abilities() {
  const { view, buyStage } = useCreation()
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Abilities</SectionLabel>
      <div className='flex flex-col rounded border border-line p-1'>
        <CatalogList label='ability' groups={view.abilityCatalog} nameOf={(entry) => entry.view.family} render={(entry) => (
          <AbilityFamilyRow key={entry.family} row={entry.view} action={
            entry.level > 0 ? <span className='text-xs text-good px-1'>{entry.bought > 0 ? 'taken' : 'racial'}</span>
            : entry.next ? <Button size='xs' variant='good' aria-label={`add ${entry.view.family}`} onClick={() => buyStage(entry.family, 1)}>+ {priceLabel(entry.next)}</Button>
            : <LockedLabel reason={entry.view.blocked} />} />
        )} />
      </div>
      {view.abilities.length ? <SectionLabel className='pt-2'>Learned</SectionLabel> : null}
      {view.abilities.map((entry) => <AbilityFamilyRow key={entry.family} row={entry.view} action={
        <span className='flex flex-row items-center gap-1'>
          {entry.racial > 0 ? <span className='text-xs text-muted' title='given by the race'>🔒 racial</span> : null}
          <Button size='xs' aria-label={`give back ${entry.view.family}`} disabled={entry.bought === 0} onClick={() => buyStage(entry.family, -1)}>−</Button>
          <Button size='xs' aria-label={`raise ${entry.view.family}`} disabled={entry.next === null} onClick={() => buyStage(entry.family, 1)}>+</Button>
          <span className='w-14 text-right text-xs text-muted'>{priceLabel(entry.next)}</span>
        </span>
      } />)}
    </div>
  )
}

// spells.tex "Learning spells": a school opened, its spells listed to unfold
// and learn by a method open to the character, and the spells chosen below.
function Magic() {
  const { view, chooseSpell, claimSpell } = useCreation()
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Magic</SectionLabel>
      {view.freeSpells.total ? (
        <span className={`text-xs ${view.freeSpells.left < 0 ? 'text-bad' : 'text-muted'}`}>
          free spells to claim: {view.freeSpells.left} of {view.freeSpells.total} · a spell you have the knowledge for, learned as a wizard
        </span>
      ) : null}
      <div className='flex flex-col rounded border border-line p-1'>
        <CatalogList label='spell' groups={view.spellCatalog} nameOf={(entry) => entry.row.name} render={(entry) => <SpellCatalogEntry key={entry.row.key} row={entry.row} action={
            entry.method ? <span className='text-xs text-good px-1'>{entry.method}{entry.free ? ' · free' : ''}</span>
            : entry.locked ? <LockedLabel reason={entry.locked} />
            : (
              <span className='flex flex-row gap-1'>
                {entry.claimable ? (
                  <Button size='xs' variant='good' aria-label={`claim ${entry.row.name} free`} title='claim as a free spell, learned as a wizard'
                    onClick={() => claimSpell(entry.row.key)}>★ free</Button>
                ) : null}
                {SpellMethodSchema.options.map((method) => entry.prices[method] ? (
                  <Button size='xs' variant='good' key={method} aria-label={`learn ${entry.row.name} ${method}`} title={`learn ${method} · ${priceLabel(entry.prices[method] ?? null)}`}
                    onClick={() => chooseSpell(entry.row.key, method)}>{method[0]}</Button>
                ) : null)}
              </span>
            )} />} />
      </div>
      {view.spells.length ? <SectionLabel className='pt-2'>Learned</SectionLabel> : null}
      {view.spells.map((entry) => <SpellCatalogEntry key={entry.row.key} row={entry.row} action={
        <span className='flex flex-row items-center gap-1'>
          <span className='text-xs text-muted'>{entry.method}{entry.free ? ' · free' : ''}</span>
          <Button size='xs' aria-label={`give back ${entry.row.name}`} onClick={() => chooseSpell(entry.row.key, null)}>−</Button>
        </span>
    } />)}
    </div>
  )
}
