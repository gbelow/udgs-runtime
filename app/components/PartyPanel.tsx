'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, selectClass } from './ui';
import { CharacterSheet } from './CharacterSheet';
import { useClock, useExploration, useParties, usePartyCommands, usePassBar } from '../hooks/useParty';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { useMapNames } from '../hooks/useMap';
import { EVENT_TYPES, type EventType } from '../domain/campaign/types';
import { DECISIONS, GROUP_KINDS } from '../domain/exploration/types';
import { ROLL_MODES, type RollMode } from '../domain/play/dice';
import type { PartyView } from '../domain/exploration/projections/exploration';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

// Everyone out of any fight: the clock they share, the parties they are in,
// and the sheet of whoever is picked, with their plan for the coming ET.
export function PartyPanel(){

  const { day, et, minutes } = useClock()
  const { map, night, dayETs, parties, decisions, results } = useParties()
  const { maps } = useMapNames()
  const passBar = usePassBar()
  const { passET, decide, sendActiveToFight, sendAllToFight, leaveParty, loadMap, setDayETs } = usePartyCommands()
  const { fightName } = useActiveCharacterData()
  const hasActive = parties.some((p) => p.members.some((m) => m.isActive))

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/6 · <span className='font-mono text-fg'>{minutes}</span> min · <span className='text-fg'>{night ? 'night' : 'daylight'}</span></span>
        <span className='text-xs text-muted'>day ETs</span>
        <NumberInput className='w-10' aria-label='day ETs' value={dayETs} onChange={(e) => setDayETs(parseInt(e.target.value) || 0)} />
        <select aria-label='map' className={selectClass} value={map?.name ?? ''} onChange={(e) => loadMap(e.target.value)}>
          <option value=''>no map</option>
          {maps.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
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
        {parties.map((party) => <PartyCard key={party.id} party={party} nodes={map?.nodes ?? null} />)}
      </div>
      {results.length > 0 ?
        <div className='flex flex-col gap-0.5 py-2 border-b border-line'>
          <SectionLabel>Last ET</SectionLabel>
          {results.map((r, i) => (
            <span key={i} className='text-xs text-muted'>
              {r.party} · <span className='text-fg'>{r.kind}</span> ({r.members.join(', ')}){r.roll ? <>: <span className='font-mono text-fg'>{r.roll.score}</span> vs DL <span className='font-mono text-fg'>{r.roll.DL}</span>, {r.roll.degree}</> : null}{r.note ? ` — ${r.note}` : ''}
              {r.events.map((e, j) => (
                <span key={j} className='block pl-3'><span className='text-fg'>{e.name}</span> vs DL <span className='font-mono text-fg'>{e.DL}</span>, {e.degree}{e.outcome ? `: ${e.outcome}` : ''}</span>
              ))}
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
function PartyCard({ party, nodes }: { party: PartyView, nodes: { id: string; name: string }[] | null }){

  const { pick, setExposure, setLit, setNode, merge, addGroup, removeGroup, setGroup, setRoller } = usePartyCommands()

  return(
    <div className='flex flex-col gap-1.5 border border-line rounded p-2 min-w-72'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-sm font-medium mr-1'>{party.name}</span>
        {nodes ?
          <select aria-label={`${party.name} node`} className={selectClass} value={party.node ?? ''} onChange={(e) => setNode(party.id, e.target.value || null)}>
            <option value=''>off the map</option>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          : null}
        <span className='text-xs text-muted'>exposure</span>
        {party.place ?
          <span className='font-mono text-xs'>{party.exposure}</span>
          : <NumberInput className='w-10' aria-label={`${party.name} exposure`} value={party.exposure} onChange={(e) => setExposure(party.id, parseInt(e.target.value) || 0)} />}
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${party.name} lit`} checked={party.lit} onChange={(e) => setLit(party.id, e.target.checked)} />light at night
        </label>
        {party.others.length > 0 ?
          <select aria-label={`${party.name} merge`} className={selectClass} value='' onChange={(e) => merge(party.id, e.target.value)}>
            <option value=''>merge into…</option>
            {party.others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          : null}
      </div>
      {party.place ?
        <span className='text-xs text-muted'>
          {party.place.terrain ?? 'no terrain'}{party.place.tags.length > 0 ? ` (${party.place.tags.join(', ')})` : ''} · location knowledge <span className='font-mono text-fg'>{party.knowledge}</span>{party.nightDL > 0 ? <> · night <span className='font-mono text-fg'>+{party.nightDL}</span> DL</> : null}
        </span>
        : null}
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
          {g.kind === 'travel' && party.place ?
            <select aria-label={`${g.kind} ${i + 1} destination`} className={selectClass} value={g.target ?? ''} onChange={(e) => setGroup(party.id, g.id, { target: e.target.value || null })}>
              <option value=''>to…</option>
              {party.paths.map((p) => <option key={p.id} value={p.id}>{p.name} (DL {p.DL})</option>)}
            </select>
            : null}
          {g.kind === 'search' && party.place ?
            <select aria-label={`${g.kind} ${i + 1} seek`} className={selectClass} value={g.seek} onChange={(e) => setGroup(party.id, g.id, { seek: e.target.value as EventType })}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            : null}
          {g.entersDL ?
            <>
              <span className='text-xs text-muted'>DL</span>
              <NumberInput className='w-10' aria-label={`${g.kind} ${i + 1} DL`} value={g.enteredDL} onChange={(e) => setGroup(party.id, g.id, { DL: parseInt(e.target.value) || 0 })} />
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
          {g.skill !== null ?
            <span className='text-xs text-muted'>skill <span className='font-mono text-fg'>{g.skill}</span> vs {g.kind === 'search' && party.place ? 'events' : <span className='font-mono text-fg'>{g.DL}</span>}</span>
            : null}
          <span className='text-xs text-muted'>{g.members.map((m) => m.name).join(', ') || 'nobody'}</span>
          <Button aria-label={`remove ${g.kind} ${i + 1}`} variant='ghost' onClick={() => removeGroup(party.id, g.id)}>×</Button>
        </div>
      ))}
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <span className='text-xs text-muted'>add</span>
        {GROUP_KINDS.map((kind) => <Button key={kind} aria-label={`${party.name} add ${kind}`} variant='ghost' disabled={kind === 'firewood' && !party.wood} title={kind === 'firewood' && !party.wood ? 'no wood here' : undefined} onClick={() => addGroup(party.id, kind)}>{kind}</Button>)}
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
          <Button key={o.label} aria-label={o.label} variant={o.selected ? 'primary' : 'default'} className={o.selected ? 'bg-accent/15' : ''} disabled={bar !== null} title={bar ?? `${signed(o.IL)} IL, ${signed(o.exhaustion)} exhaustion${o.hunger ? `, ${signed(o.hunger)} hunger` : ''}${o.thirst ? `, ${signed(o.thirst)} thirst` : ''}${o.idle && o.plan ? ' (no healing rests left today)' : ''}`}
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
