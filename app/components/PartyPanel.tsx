'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, selectClass } from './ui';
import { CharacterSheet } from './CharacterSheet';
import { useClock, useExploration, useParties, usePartyCommands, usePassBar } from '../hooks/useParty';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { DECISIONS, GROUP_KINDS, LIGHTS, type Light } from '../domain/campaign/types';
import { ROLL_MODES, type RollMode } from '../domain/combat/dice';
import type { PartyView } from '../domain/campaign/projections/exploration';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

// Everyone out of any fight: the clock they share, the parties they are in,
// and the sheet of whoever is picked, with their plan for the coming ET.
export function PartyPanel(){

  const { day, et, minutes } = useClock()
  const { parties, decisions, results } = useParties()
  const passBar = usePassBar()
  const { passET, decide, sendActiveToFight, sendAllToFight, leaveParty } = usePartyCommands()
  const { fightName } = useActiveCharacterData()
  const hasActive = parties.some((p) => p.members.some((m) => m.isActive))

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/6 · <span className='font-mono text-fg'>{minutes}</span> min</span>
        <Button aria-label='passET' disabled={passBar !== null} title={passBar ?? undefined} onClick={passET}>next ET</Button>
        {passBar ? <span className='text-xs text-muted grow'>{passBar}</span> : <span className='grow' />}
        <Button aria-label='allToFight' disabled={parties.length === 0} onClick={sendAllToFight}>all to fight</Button>
      </div>
      {decisions.length > 0 ?
        <div className='flex flex-col gap-1 py-2 border-b border-line'>
          <SectionLabel>Forced to rest</SectionLabel>
          {decisions.map((d) => (
            <div key={d.id} className='flex flex-row gap-1.5 items-center'>
              <span className='text-xs'>{d.name}</span>
              {DECISIONS.map((option) => (
                <Button key={option} aria-label={`${d.name} ${option}`} variant={d.decision === option ? 'primary' : 'default'} onClick={() => decide(d.id, option)}>{option === 'leave' ? 'leave behind' : option}</Button>
              ))}
            </div>
          ))}
        </div>
        : null}
      <div className='flex flex-row flex-wrap gap-2 py-2 border-b border-line'>
        {parties.map((party) => <PartyCard key={party.id} party={party} />)}
      </div>
      {results.length > 0 ?
        <div className='flex flex-col gap-0.5 py-2 border-b border-line'>
          <SectionLabel>Last ET</SectionLabel>
          {results.map((r, i) => (
            <span key={i} className='text-xs text-muted'>
              {r.party} · <span className='text-fg'>{r.kind}</span> ({r.members.join(', ')}){r.roll ? <>: <span className='font-mono text-fg'>{r.roll.score}</span> vs DL <span className='font-mono text-fg'>{r.roll.DL}</span>, {r.roll.degree}</> : null}{r.note ? ` — ${r.note}` : ''}
            </span>
          ))}
        </div>
        : null}
      {
        hasActive ?
        <CharacterSheet
          header={
            <div className='flex flex-row flex-wrap gap-1.5 items-center'>
              <span className='text-base font-medium mr-2'>{fightName}</span>
              <Button aria-label='toFight' onClick={sendActiveToFight}>to fight</Button>
              <Button aria-label='leaveParty' variant='bad' onClick={leaveParty}>leave party</Button>
            </div>
          }
          afterInjury={<ExplorationSection />}
        />
        : null
      }
    </div>
  )
}

// One party: who is in it and what they plan, where they are, their camp, and
// the groups going on an action.
function PartyCard({ party }: { party: PartyView }){

  const { pick, setExposure, setLight, merge, addGroup, removeGroup, setGroup, setRoller } = usePartyCommands()

  return(
    <div className='flex flex-col gap-1.5 border border-line rounded p-2 min-w-72'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-sm font-medium mr-1'>{party.name}</span>
        <span className='text-xs text-muted'>exposure</span>
        <NumberInput className='w-10' aria-label={`${party.name} exposure`} value={party.exposure} onChange={(e) => setExposure(party.id, parseInt(e.target.value) || 0)} />
        <select aria-label={`${party.name} light`} className={selectClass} value={party.light} onChange={(e) => setLight(party.id, e.target.value as Light)}>
          {LIGHTS.map((l) => <option key={l} value={l}>{l === 'lit' ? 'night, lit' : l === 'dark' ? 'night, dark' : l}</option>)}
        </select>
        {party.others.length > 0 ?
          <select aria-label={`${party.name} merge`} className={selectClass} value='' onChange={(e) => merge(party.id, e.target.value)}>
            <option value=''>merge into…</option>
            {party.others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          : null}
      </div>
      <span className='text-xs text-muted'>
        shelter <span className='font-mono text-fg'>{party.camp.shelter}</span> · firewood <span className='font-mono text-fg'>{party.camp.firewood}</span> ET · fire <span className='text-fg'>{party.camp.fire ? 'burning' : 'out'}</span>{party.camp.progress.length > 0 ? ` · under way: ${party.camp.progress.join(', ')}` : ''} · rest exposure <span className='font-mono text-fg'>{party.restExposure}</span>
      </span>
      <div className='flex flex-row flex-wrap gap-1.5'>
        {party.members.map((m) => (
          <Button key={m.id} aria-label={m.name} disabled={m.out} variant={m.isActive ? 'primary' : 'default'} className={m.isActive ? 'bg-accent/15' : ''} onClick={() => pick(m.id)}>{m.name} <span className='text-muted'>· {m.out ? 'in a fight' : m.plan}</span></Button>
        ))}
      </div>
      {party.groups.map((g, i) => (
        <div key={g.id} className='flex flex-row flex-wrap gap-1.5 items-center border-t border-line pt-1'>
          <span className='text-xs font-medium'>{g.kind} {i + 1}</span>
          <select aria-label={`${g.kind} ${i + 1} roller`} className={selectClass} value={g.roller ?? ''} onChange={(e) => setRoller(party.id, g.id, e.target.value)}>
            <option value=''>roller…</option>
            {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className='text-xs text-muted'>DL</span>
          <NumberInput className='w-10' aria-label={`${g.kind} ${i + 1} DL`} value={g.enteredDL} onChange={(e) => setGroup(party.id, g.id, { DL: parseInt(e.target.value) || 0 })} />
          {g.kind === 'travel' || g.kind === 'search' ?
            <>
              <span className='text-xs text-muted'>knowledge</span>
              <NumberInput className='w-10' aria-label={`${g.kind} ${i + 1} knowledge`} value={g.knowledge} onChange={(e) => setGroup(party.id, g.id, { knowledge: parseInt(e.target.value) || 0 })} />
            </>
            : null}
          {g.kind === 'fire' ?
            <label className='text-xs text-muted flex items-center gap-1'>
              <input type='checkbox' aria-label={`${g.kind} ${i + 1} tool`} checked={g.tool} onChange={(e) => setGroup(party.id, g.id, { tool: e.target.checked })} />tool
            </label>
            : null}
          <select aria-label={`${g.kind} ${i + 1} mode`} className={selectClass} value={g.mode} onChange={(e) => setGroup(party.id, g.id, { mode: e.target.value as RollMode })}>
            {ROLL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {g.skill !== null ? <span className='text-xs text-muted'>skill <span className='font-mono text-fg'>{g.skill}</span> vs <span className='font-mono text-fg'>{g.DL}</span></span> : null}
          <span className='text-xs text-muted'>{g.members.map((m) => m.name).join(', ') || 'nobody'}</span>
          <Button aria-label={`remove ${g.kind} ${i + 1}`} variant='ghost' onClick={() => removeGroup(party.id, g.id)}>×</Button>
        </div>
      ))}
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <span className='text-xs text-muted'>add</span>
        {GROUP_KINDS.map((kind) => <Button key={kind} aria-label={`${party.name} add ${kind}`} variant='ghost' onClick={() => addGroup(party.id, kind)}>{kind}</Button>)}
      </div>
    </div>
  )
}

// survival.tex "Exhaustion", "Rest", "Wear" — what the character will spend
// the coming ET on, and eating and drinking, which take no ET.
function ExplorationSection(){

  const [nutrition, setNutrition] = useState(3)
  const { bar, options, willDL, lastRoll, potion } = useExploration()
  const { joinGroup, rest, eat, drink } = usePartyCommands()

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Next exploration turn</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        {options.map((o) => (
          <Button key={o.label} aria-label={o.label} variant={o.selected ? 'primary' : 'default'} className={o.selected ? 'bg-accent/15' : ''} disabled={bar !== null} title={bar ?? `${signed(o.IL)} IL, ${signed(o.exhaustion)} exhaustion${o.idle && o.plan ? ' (no healing rests left today)' : ''}`}
            onClick={() => (o.plan === null ? rest(false) : o.plan === 'rest' ? rest(true) : joinGroup(o.plan.group))}>{o.label}</Button>
        ))}
      </div>
      {potion > 0 ? <span className='text-xs text-muted'>potion heals up to <span className='font-mono text-fg'>{potion}</span> IL over the ET</span> : null}
      {willDL !== null ? <span className='text-xs text-muted'>Will test DL <span className='font-mono text-fg'>{willDL}</span> opens the ET; a graze or miss forces a rest</span> : null}
      {lastRoll ? <span className='text-xs text-muted'>Will test last ET: <span className='font-mono text-fg'>{lastRoll.score}</span> vs DL <span className='font-mono text-fg'>{lastRoll.DL}</span>, {lastRoll.degree}</span> : null}
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-muted'>portion</span>
        <NumberInput className='w-12' aria-label='nutrition' value={nutrition} onChange={(e) => setNutrition(parseInt(e.target.value) || 0)} />
        <Button aria-label='eat' disabled={bar !== null} title={bar ?? undefined} onClick={() => eat(nutrition)}>eat</Button>
        <Button aria-label='drink' disabled={bar !== null} title={bar ?? undefined} onClick={drink}>drink water</Button>
      </div>
    </div>
  )
}
