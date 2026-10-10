'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, TextInput, selectClass } from './ui';
import { useClock } from '../hooks/useParty';
import { useDowntime, useDowntimeCommands, useSkillOptions, useTrainingOptions } from '../hooks/useDowntime';
import type { LivingLevel } from '../domain/lists';
import type { BlockView, DowntimeCharacterView, DowntimeTest } from '../domain/downtime/projections/downtime';

const num = (value: string) => parseInt(value) || 0

type Commands = ReturnType<typeof useDowntimeCommands>

// story.tex "Downtime": the days everyone on the roster spends at once — how
// each lives, the one activity each is on, what it costs, tests and yields,
// and how long they can pay for it.
export function DowntimePanel(){

  const [span, setSpan] = useState<number | null>(null)
  const { day, et, etsPerDay } = useClock()
  const { days, defaultSpan, settled, bar, characters, results } = useDowntime(span)
  const commands = useDowntimeCommands()

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row flex-wrap gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/{etsPerDay}</span>
        {settled ? <span className='text-xs text-muted'>{settled}</span> : null}
        <span className='text-xs text-muted'>days</span>
        <NumberInput className='w-12' aria-label='days' placeholder={`${defaultSpan}`} value={span ?? ''} onChange={(e) => setSpan(e.target.value === '' ? null : num(e.target.value))} />
        <Button aria-label='passDays' variant='primary' disabled={bar !== null} title={bar ?? undefined} onClick={() => { commands.passDays(days); setSpan(null) }}>pass {days} days</Button>
        {bar ? <span className='text-xs text-muted grow'>{bar}</span> : null}
      </div>
      <div className='flex flex-row flex-wrap gap-2 py-2 border-b border-line'>
        {characters.map((c) => <CharacterCard key={c.id} character={c} days={days} commands={commands} />)}
      </div>
      {results.length > 0 ?
        <div className='flex flex-col gap-0.5 py-2'>
          <SectionLabel>Last days</SectionLabel>
          {results.map((r, i) => (
            <span key={i} className='text-xs text-muted'>
              {r.name} · <span className='text-fg'>{r.what}</span>{r.roll ? <>: <span className='font-mono text-fg'>{r.roll.score}</span> vs DL <span className='font-mono text-fg'>{r.roll.DL}</span>, {r.roll.degree}</> : null}{r.note ? ` — ${r.note}` : ''}
            </span>
          ))}
        </div>
        : null}
    </div>
  )
}

function CharacterCard({ character: c, days, commands }: { character: DowntimeCharacterView, days: number, commands: Commands }){

  const { pick, setLiving, setHoused } = commands

  return(
    <div className={`flex flex-col gap-1.5 border rounded p-2 min-w-80 max-w-xl ${c.isActive ? 'border-accent' : 'border-line'}`}>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <button type='button' className='text-sm font-medium mr-1 hover:text-accent' onClick={() => pick(c.id)}>{c.name}</button>
        <select aria-label={`${c.name} living`} className={selectClass} value={c.living} disabled={c.housed} onChange={(e) => setLiving(c.id, e.target.value as LivingLevel)}>
          {c.livingOptions.map((o) => <option key={o.level} value={o.level}>{o.level} · {o.cost}/day · exposure {o.exposure}</option>)}
        </select>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${c.name} housed`} checked={c.housed} onChange={(e) => setHoused(c.id, e.target.checked)} />housed
        </label>
      </div>
      <span className='text-xs text-muted'>
        purse <span className='font-mono text-fg'>{c.purse}</span> · heals <span className='font-mono text-fg'>{c.dailyHealing}</span> IL a day ({c.healing}) · activity <span className='font-mono text-fg'>{c.planDays}</span> days · <span className={c.short ? 'text-bad' : ''}>pays for <span className='font-mono'>{c.affordable}</span> of {days} days</span>
      </span>
      {c.block ? <ActivityRow id={c.id} view={c.block} specific={c.specific} commands={commands} /> : <NewActivity id={c.id} commands={commands} />}
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
function ActivityRow({ id, view: v, specific, commands }: { id: string, view: BlockView, specific: string[], commands: Commands }){

  const { setBlock, setLearningGain, decide, drop } = commands
  const b = v.block
  const set = (patch: Record<string, unknown>) => setBlock(id, patch)
  const field = (label: string, key: string, value: number) => (
    <label className='text-xs text-muted flex items-center gap-1'>{label}
      <NumberInput className='w-12' aria-label={label} value={value} onChange={(e) => set({ [key]: num(e.target.value) })} />
    </label>
  )
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
            <TextInput className='w-28' list={`specific-${id}`} aria-label='knowledge' placeholder='specific knowledge' value={b.knowledge} onChange={(e) => set({ knowledge: e.target.value })} />
            <datalist id={`specific-${id}`}>{specific.map((k) => <option key={k} value={k} />)}</datalist>
            {testPicker}{field('DL', 'DL', b.DL)}{field('max', 'max', b.max)}
            <span className='text-xs text-muted'>gains</span>
            {b.gains.map((g, i) => <NumberInput key={i} className='w-8' aria-label={`gain ${i}`} value={g} onChange={(e) => setLearningGain(id, i, num(e.target.value))} />)}
          </>
          : null}
        {b.kind === 'training' ?
          <>
            <Button size='xs' variant={b.decision === 'accepted' ? 'good' : 'default'} onClick={() => decide(id, 'accepted')}>trainer found</Button>
            <Button size='xs' variant={b.decision === 'refused' ? 'bad' : 'default'} onClick={() => decide(id, 'refused')}>none</Button>
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

// A new activity: a training asked of the table or done alone, a job, a
// doctor or a learning test.
function NewActivity({ id, commands }: { id: string, commands: Commands }){

  const { addTraining, addBlock } = commands
  const training = useTrainingOptions(id)
  const [pick, setPick] = useState('')
  const chosen = training.find((o) => o.id === pick)

  return(
    <div className='flex flex-row flex-wrap gap-1.5 items-center border-t border-line pt-1'>
      <select aria-label='train' className={selectClass} value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value=''>train…</option>
        {training.map((o) => <option key={o.id} value={o.id}>{o.label} → {o.level} ({o.toNext} XP to go)</option>)}
      </select>
      <Button size='xs' disabled={!chosen} onClick={() => chosen && addTraining(id, chosen.target, true)}>ask for a trainer</Button>
      <Button size='xs' disabled={!chosen?.alone} title={chosen && !chosen.alone ? 'no talent to train it alone' : undefined} onClick={() => chosen && addTraining(id, chosen.target, false)}>
        alone{chosen?.alone ? ` (${chosen.alone.skill} vs ${chosen.alone.DL})` : ''}
      </Button>
      <span className='grow' />
      <Button size='xs' onClick={() => addBlock(id, 'job')}>+ job</Button>
      <Button size='xs' onClick={() => addBlock(id, 'doctor')}>+ doctor</Button>
      <Button size='xs' onClick={() => addBlock(id, 'learning')}>+ learning</Button>
    </div>
  )
}
