'use client'
import { useState } from 'react'
import { Button, CollectionSelect, NumberInput, Tooltip, barred, selectClass } from './ui';
import { ClockLabel, RosterCatalog, RosterChip } from './RunParts';
import { useDowntime, useDowntimeAnswer, useDowntimeCalls, useDowntimeCommands, useDowntimeDiceBar, useDowntimeResults, useDowntimeSpan, useSkillOptions, useTrainingOptions } from '../hooks/useDowntime';
import type { LivingLevel } from '../domain/lists';
import { ACTIVITIES, isTableTerm, type Activity } from '../domain/downtime/types';
import { useGmBar } from '../hooks/useControl';
import { useCollectionFilter } from '../hooks/useCollections';
import { Locked, LockedFor } from './Locks';
import { DieCalls } from './DieCalls';
import type { BlockView, DowntimeCharacterView, DowntimeTest } from '../domain/downtime/projections/downtime';

const num = (value: string) => parseInt(value) || 0

type Commands = ReturnType<typeof useDowntimeCommands>

// Downtime's pieces of the run screen.

// story.tex "Downtime": the days every running party spends at once — the
// moments they are living, how many days, the button that passes them, and
// who spends them with the activity they are on.
export function DowntimeStrip(){

  const { span, setSpan } = useDowntimeSpan()
  const { days, defaultSpan, settled, bar: passBar, characters } = useDowntime()
  const { pick, passDays } = useDowntimeCommands()
  const gmBar = useGmBar()
  const bar = gmBar ?? passBar

  return(
    <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center'>
      <div className='flex flex-row gap-2 items-center'>
        <ClockLabel />
        {settled ? <span className='text-xs text-muted'>{settled}</span> : null}
        <span className='text-xs text-muted'>days</span>
        <NumberInput className='w-12' aria-label='days' placeholder={`${defaultSpan}`} value={span ?? ''} onChange={(e) => setSpan(e.target.value === '' ? null : num(e.target.value))} />
        <Tooltip text={bar ?? 'every running party spends the days on its activities'}>
          <Button aria-label='passDays' variant='primary' disabled={bar !== null} onClick={() => { passDays(days); setSpan(null) }}>pass {days} days</Button>
        </Tooltip>
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {characters.map((c) => <RosterChip key={c.id} name={c.name} active={c.isActive} bad={c.short} note={c.block ? c.block.label : 'no activity'} onClick={() => pick(c.id)} />)}
      </div>
      {passBar ? <span className='text-xs text-muted'>{passBar}</span> : null}
    </div>
  )
}

// Everyone on the roster in a row each: how they live, their purse and
// healing, the activity they are on, and how many of the days they pay for.
// The activity is set for the active character beside the sheet.
export function DowntimeRoster(){

  const { days, characters } = useDowntime()
  const calls = useDowntimeCalls()
  const answer = useDowntimeAnswer()

  return(
    <RosterCatalog>
      <DieCalls rows={calls} answer={answer} />
      {characters.length === 0 ? <span className='text-xs text-muted'>nobody on the roster: add characters</span> : null}
      <Locked bar={useDowntimeDiceBar()}>
        <div className='flex flex-col'>
          {characters.map((c) => <RosterRow key={c.id} character={c} days={days} />)}
        </div>
      </Locked>
    </RosterCatalog>
  )
}

// One character's row: how they live is theirs to set, or the GM's.
function RosterRow({ character: c, days }: { character: DowntimeCharacterView, days: number }){

  const { pick, setLiving, setHoused } = useDowntimeCommands()

  return(
    <div className={`flex flex-row flex-wrap gap-x-3 gap-y-1 items-center px-2 py-1 border-l-2 ${c.isActive ? 'border-accent bg-accent/5' : 'border-transparent'}`}>
      <button type='button' className='text-sm font-medium w-32 text-left truncate hover:text-accent' aria-label={`pick ${c.name}`} onClick={() => pick(c.id)}>{c.name}</button>
      <LockedFor id={c.id} className='contents'>
        <select aria-label={`${c.name} living`} className={selectClass} value={c.living} disabled={c.housed} onChange={(e) => setLiving(c.id, e.target.value as LivingLevel)}>
          {c.livingOptions.map((o) => <option key={o.level} value={o.level}>{o.level} · {o.cost}/day · exposure {o.exposure}</option>)}
        </select>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${c.name} housed`} checked={c.housed} onChange={(e) => setHoused(c.id, e.target.checked)} />housed
        </label>
      </LockedFor>
      <span className='text-xs text-muted'>purse <span className='font-mono text-fg'>{c.purse}</span></span>
      <span className='text-xs text-muted'>heals <span className='font-mono text-fg'>{c.dailyHealing}</span> IL a day ({c.healing})</span>
      <span className='text-xs text-muted'>{c.block ? <><span className='text-fg'>{c.block.label}</span> to day {c.block.lastDay}</> : 'no activity'}</span>
      <span className={`text-xs ${c.short ? 'text-bad' : 'text-muted'}`}>pays for <span className='font-mono'>{c.affordable}</span> of {days} days</span>
      {c.block?.bar ? <span className='text-xs text-bad'>{c.block.bar}</span> : null}
    </div>
  )
}

// The active character's activity: the four to choose from, and the one
// under way with its days, cost, test and yield.
export function DowntimeActions(){

  const { characters } = useDowntime()
  const commands = useDowntimeCommands()
  const c = characters.find((x) => x.isActive)
  if (!c) return null

  return(
    <div className='flex flex-col gap-1'>
      <span className='text-xs text-muted'>activity <span className='font-mono text-fg'>{c.planDays}</span> days</span>
      <ActivityPicker key={c.id} character={c} commands={commands} />
    </div>
  )
}

// What the last days came to, character by character.
export function LastDaysLog(){
  const results = useDowntimeResults()
  if (results.length === 0) return <span className='text-xs text-muted'>no days passed yet</span>

  return(
    <div className='flex flex-col gap-0.5'>
      {results.map((line, i) => <span key={i} className='text-xs text-muted'>{line}</span>)}
    </div>
  )
}

const ACTIVITY_HINTS: Record<Activity, string> = {
  training: 'XP toward the next level, with a trainer or alone',
  job: 'a wage a day, tested at the end',
  doctor: 'IL healed for a price',
  learning: 'levels of a specific knowledge, tested at the end',
}

// story.tex "Downtime": the four things a character can spend their days on,
// one at a time; the one chosen stays marked and opens its details.
function ActivityPicker({ character: c, commands }: { character: DowntimeCharacterView, commands: Commands }){

  const [picked, setPicked] = useState<Activity | null>(null)
  const selected = picked ?? c.activity
  const choose = (activity: Activity) => {
    if (activity === 'training') { setPicked(c.activity === 'training' ? null : 'training'); return }
    setPicked(null)
    commands.chooseActivity(c.id, activity)
  }

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        {ACTIVITIES.map((activity) => (
          <Button key={activity} size='xs' selected={selected === activity} title={ACTIVITY_HINTS[activity]} onClick={() => choose(activity)}>{activity}</Button>
        ))}
        {c.activity && c.block && c.block.elapsed > 0 && selected !== c.activity ? <span className='text-xs text-bad'>choosing another drops {c.block.elapsed} days spent</span> : null}
      </div>
      {selected === 'training' ? <TrainingChooser character={c} commands={commands} onChosen={() => setPicked(null)} /> : null}
      {c.block && selected === c.activity ? <ActivityRow id={c.id} view={c.block} commands={commands} /> : null}
    </div>
  )
}

function TestLine({ test }: { test: DowntimeTest | null }){
  return test ? <span>test <span className='font-mono text-fg'>{test.skill}</span> vs DL <span className='font-mono text-fg'>{test.DL}</span> ({test.label})</span> : null
}

function TestPicker({ id, value, onPick }: { id: string, value: string, onPick: (ref: unknown) => void }){
  const skills = useSkillOptions(id)
  return (
    <select aria-label='test' className={selectClass} value={value} onChange={(e) => onPick(skills.find((s) => s.id === e.target.value)?.ref)}>
      {skills.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.value})</option>)}
    </select>
  )
}

// The activity under way: what it is, its days, cost, test and yield, the
// table's settings for it, and why it cannot be spent yet.
function ActivityRow({ id, view: v, commands }: { id: string, view: BlockView, commands: Commands }){
  const knowledges = useCollectionFilter('knowledges')

  const { setBlock, setLearningGain, decide, drop } = commands
  const gmBar = useGmBar()
  const b = v.block
  const set = (patch: Record<string, unknown>) => setBlock(id, patch)
  const field = (label: string, key: string, value: number) => {
    return (
      <label className='text-xs text-muted flex items-center gap-1'>{label}
        <NumberInput className='w-12' aria-label={label} {...barred(isTableTerm(key) ? gmBar : null)} value={value} onChange={(e) => set({ [key]: num(e.target.value) })} />
      </label>
    )
  }
  const testPicker = v.testId ? <TestPicker id={id} value={v.testId} onPick={(test) => set({ test })} /> : null

  return(
    <div className='flex flex-col gap-1 border-t border-line pt-1'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-fg'>{v.label}</span>
        <span className='text-xs text-muted'>to day {v.lastDay}{v.elapsed > 0 ? ` (${v.elapsed} spent)` : ''}</span>
        {b.kind === 'training' || b.kind === 'self' ? field('XP', 'XP', b.XP) : field('days', 'days', b.days)}
        {b.kind === 'training' ? field('rate CP/day', 'rate', b.rate) : null}
        {b.kind === 'job' ? <>{testPicker}{field('DL', 'DL', b.DL)}{field('wage CP/day', 'wage', b.wage)}</> : null}
        {b.kind === 'doctor' ? <>{field('IL/day', 'capacity', b.capacity)}{field('CP/IL', 'price', b.price)}</> : null}
        {b.kind === 'learning' ?
          <>
            <select aria-label='knowledge' className={selectClass} value={b.knowledge} onChange={(e) => set({ knowledge: e.target.value })}>
              <option value=''>specific knowledge…</option>
              {b.knowledge && !knowledges.has(b.knowledge) ? <option value={b.knowledge}>{b.knowledge} (not in the collection)</option> : null}
              {knowledges.keys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <CollectionSelect label='knowledge collection' filter={knowledges} />
            {testPicker}{field('DL', 'DL', b.DL)}{field('max', 'max', b.max)}
            <span className='text-xs text-muted'>gains</span>
            {b.gains.map((g, i) => <NumberInput key={i} className='w-8' aria-label={`gain ${i}`} {...barred(gmBar)} value={g} onChange={(e) => setLearningGain(id, i, num(e.target.value))} />)}
          </>
          : null}
        {b.kind === 'training' ?
          <>
            <Button size='xs' variant={b.decision === 'accepted' ? 'good' : 'default'} {...barred(gmBar)} onClick={() => decide(id, 'accepted')}>trainer found</Button>
            <Button size='xs' variant={b.decision === 'refused' ? 'bad' : 'default'} {...barred(gmBar)} onClick={() => decide(id, 'refused')}>none</Button>
          </>
          : null}
        <Button aria-label='drop activity' variant='ghost' onClick={() => drop(id)}>×</Button>
      </div>
      <span className='text-xs text-muted'>
        <TestLine test={v.test} />{v.test ? ' · ' : ''}cost {v.cost} · yields {v.yields}
      </span>
      {v.bar ? <span className='text-xs text-bad'>{v.bar}</span> : null}
    </div>
  )
}

// What a training is for, and whether it is asked of a trainer or done
// alone; the choice made stays marked.
function TrainingChooser({ character: c, commands, onChosen }: { character: DowntimeCharacterView, commands: Commands, onChosen: () => void }){

  const training = useTrainingOptions(c.id)
  const [pick, setPick] = useState('')
  const targetId = pick || c.training?.id || ''
  const chosen = training.find((o) => o.id === targetId)
  const take = (withTrainer: boolean) => { if (chosen) { commands.chooseTraining(c.id, chosen.target, withTrainer); setPick(''); onChosen() } }
  const pickTarget = (id: string) => {
    setPick(id)
    const option = training.find((o) => o.id === id)
    if (option && c.training) { commands.chooseTraining(c.id, option.target, c.training.withTrainer); setPick('') }
  }

  return(
    <div className='flex flex-row flex-wrap gap-1.5 items-center'>
      <select aria-label='train' className={selectClass} value={targetId} onChange={(e) => pickTarget(e.target.value)}>
        <option value=''>train…</option>
        {training.map((o) => <option key={o.id} value={o.id}>{o.label} → {o.level} ({o.toNext} XP to go)</option>)}
      </select>
      <Button size='xs' disabled={!chosen} selected={c.training?.withTrainer} onClick={() => take(true)}>with a trainer</Button>
      <Button size='xs' disabled={!chosen?.alone} selected={c.training?.withTrainer === false} title={chosen && !chosen.alone ? 'no talent to train it alone' : undefined} onClick={() => take(false)}>
        alone{chosen?.alone ? ` (${chosen.alone.skill} vs ${chosen.alone.DL})` : ''}
      </Button>
    </div>
  )
}
