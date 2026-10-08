'use client'

import { useState } from 'react'
import { Button, ListButton, Row, SectionLabel, StatTile, TextInput, Tiles, inputClass, selectClass } from './ui'
import { MovementPanel } from './MovementPanel'
import { SensesPanel } from './SensesPanel'
import { BodyEditor, Creature, NaturalArmor } from './CreatureEditor'
import { useRace, useRaceAbilityOptions, useRaceBonus } from '../hooks/useRace'
import { RACE_BONUS_KEYS, type RaceBonusKey } from '../domain/types'

// The race tab: the saved races listed on the left, the race being made on
// the right. A race is made here and saved; characters start from it in the
// character tab.
export function RaceCreator() {
  return (
    <div className='grid grid-cols-12 gap-2 py-2 text-left text-sm'>
      <RaceList />
      <div className='col-span-9 flex flex-col gap-4 max-h-[85vh] overflow-y-auto pr-2'>
        <RaceHeader />
        <div className='grid grid-cols-1 md:grid-cols-12 gap-4'>
          <div className='md:col-span-7 flex flex-col gap-3'>
            <RaceBonuses />
            <RaceAbilities />
            <Creature />
            <div className='flex flex-row flex-wrap gap-6'>
              <MovementPanel />
              <SensesPanel />
            </div>
          </div>
          <div className='md:col-span-5 flex flex-col gap-3'>
            <NaturalArmor />
            <BodyEditor />
          </div>
        </div>
      </div>
    </div>
  )
}

function RaceList() {
  const { view, races, open, create } = useRace()
  return (
    <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
      <div className='flex flex-row items-center gap-1'>
        <SectionLabel>Races</SectionLabel>
        <span className='grow' />
        <Button size='xs' variant='good' onClick={create}>+ new</Button>
      </div>
      {races.map((name) => (
        <ListButton key={name} selected={view.name === name} onClick={() => open(name)}>{name}</ListButton>
      ))}
    </div>
  )
}

function RaceHeader() {
  const { view, races, edit, save, remove } = useRace()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap items-center gap-2'>
        <TextInput className='w-40 text-base font-medium' aria-label='race name' placeholder='race name' value={view.name} onChange={(e) => edit({ name: e.target.value })} />
        <label className='flex flex-row items-center gap-1 text-xs text-muted'>
          <input type='checkbox' className='accent-accent' checked={view.playable} onChange={(e) => edit({ playable: e.target.checked })} />
          playable
        </label>
        <Button variant='primary' onClick={save} disabled={!view.name.trim()}>save race</Button>
        {races.includes(view.name) ? (confirm ?
          <>
            <Button variant='bad' className='bg-bad/15' onClick={async () => { await remove(view.name); setConfirm(false) }}>confirm delete</Button>
            <Button onClick={() => setConfirm(false)}>cancel</Button>
          </> :
          <Button variant='bad' onClick={() => setConfirm(true)}>delete race</Button>) : null}
      </div>
      <textarea aria-label='race description' placeholder='description' className={`${inputClass} p-1 min-h-12 w-full text-sm bg-surface`}
        value={view.description} onChange={(e) => edit({ description: e.target.value })} />
    </div>
  )
}

function BonusDial({ bonus }: { bonus: RaceBonusKey }) {
  const [value, setValue] = useRaceBonus(bonus)
  return <StatTile label={bonus} value={value} onChange={setValue} />
}

function RaceBonuses() {
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Bonuses</SectionLabel>
      <Tiles>{RACE_BONUS_KEYS.map((key) => <BonusDial key={key} bonus={key} />)}</Tiles>
    </div>
  )
}

function RaceAbilities() {
  const { view, addAbility, removeAbility } = useRace()
  const abilityOptions = useRaceAbilityOptions()
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Abilities</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {view.abilities.map((a) => (
          <Row key={a.key}>
            {a.name}
            <button type='button' aria-label={`remove ${a.name}`} className='text-muted hover:text-bad cursor-pointer' onClick={() => removeAbility(a.key)}>×</button>
          </Row>
        ))}
        <select aria-label='add race ability' className={selectClass} value='' onChange={(e) => e.target.value && addAbility(e.target.value)}>
          <option value=''>+ ability</option>
          {abilityOptions.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select>
      </div>
    </div>
  )
}
