'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, Tooltip, barred, selectClass } from './ui';
import { ClockLabel, RosterCatalog } from './RunParts';
import { useETAnswer, useETCalls, useETDiceBar, useExploration, useNodeOptions, useParties, usePartyCommands, usePassBar } from '../hooks/useParty';
import { DieCalls } from './DieCalls';
import { useActorBar, useGmBar } from '../hooks/useControl';
import { Locked, LockedFor } from './Locks';
import { EVENT_TYPES, type EventType } from '../domain/campaign/types';
import { DECISIONS, GROUP_KINDS, type CastPlan } from '../domain/exploration/types';
import { ROLL_MODES, type RollMode } from '../domain/play/dice';
import type { CastPanel, PartiesView, PartyView } from '../domain/exploration/projections/exploration';
import type { MapOptions } from '../domain/campaign/projections/maps';

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

// Exploration's pieces of the run screen.

// The moments the parties in play are living, and the ET passing.
export function ExplorationStrip(){

  const { dayETs } = useParties()
  const passBar = usePassBar()
  const gmBar = useGmBar()
  const bar = gmBar ?? passBar
  const { passET, setDayETs } = usePartyCommands()

  return(
    <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center'>
      <div className='flex flex-row gap-2 items-center'>
        <ClockLabel />
        <span className='text-xs text-muted whitespace-nowrap'>day ETs</span>
        <NumberInput className='w-10' aria-label='day ETs' {...barred(gmBar)} value={dayETs} onChange={(e) => setDayETs(parseInt(e.target.value) || 0)} />
        <Tooltip text={bar ?? 'every running party spends the ET on its plan'}>
          <Button aria-label='passET' disabled={bar !== null} onClick={passET}>next ET</Button>
        </Tooltip>
      </div>
      {passBar ? <span className='text-xs text-muted'>{passBar}</span> : null}
    </div>
  )
}

// The parties: who must decide whether to rest, and each party's place,
// camp and groups; the catalog opens beside them to bring characters onto
// the roster.
export function PartyCards(){

  const { parties, decisions } = useParties()
  const maps = useNodeOptions()
  const calls = useETCalls()
  const answer = useETAnswer()
  const diceBar = useETDiceBar()

  if (parties.length === 0) return <span className='text-xs text-muted'>a party needs to be loaded and a timeline needs to be started</span>

  return(
    <RosterCatalog>
      <DieCalls rows={calls} answer={answer} />
      <Locked bar={diceBar}>
      {decisions.length > 0 ?
        <div className='flex flex-col gap-1 pb-2 border-b border-line'>
          <SectionLabel>Forced to rest</SectionLabel>
          {decisions.map((d) => <DecisionRow key={d.id} decision={d} />)}
        </div>
        : null}
      <div className='flex flex-row flex-wrap gap-2 items-start'>
        {parties.map((party) => <PartyCard key={party.id} party={party} maps={maps} />)}
      </div>
      </Locked>
    </RosterCatalog>
  )
}

// Whether a character forced to rest is waited for or left behind: theirs
// to decide, or the GM's.
function DecisionRow({ decision: d }: { decision: PartiesView['decisions'][number] }){

  const { decide } = usePartyCommands()

  return(
    <div className='flex flex-row gap-1.5 items-center'>
      <span className='text-xs'>{d.name}</span>
      <LockedFor id={d.id} className='contents'>
        {DECISIONS.map((option) => (
          <Button key={option} aria-label={`${d.name} ${option}`} selected={d.decision === option} onClick={() => decide(d.id, option)}>{option === 'leave' ? 'leave behind' : option}</Button>
        ))}
      </LockedFor>
    </div>
  )
}

// What the last ET came to, party by party.
export function LastEtLog(){
  const { lastET } = useParties()
  if (lastET.length === 0) return <span className='text-xs text-muted'>no ET passed yet</span>

  return(
    <div className='flex flex-col gap-0.5'>
      {lastET.map((line, i) => <span key={i} className='text-xs text-muted whitespace-pre-wrap'>{line}</span>)}
    </div>
  )
}

// One party: who is in it and what they plan, where they are, their camp, and
// the groups going on an action.
function PartyCard({ party, maps }: { party: PartyView, maps: MapOptions[] }){

  const { pick, setExposure, setLit, setPlace, merge, addGroup, removeGroup, setGroup, setRoller } = usePartyCommands()
  const gmBar = useGmBar()
  const partyBar = useActorBar({ anyOf: party.members.map((m) => m.id) })
  const choose = (key: string) => setPlace(party.id, maps.flatMap((m) => m.nodes).find((n) => n.key === key)?.at ?? null)

  return(
    <div className='flex flex-col gap-1.5 border border-line rounded p-2 min-w-72'>
      <Locked bar={gmBar} className='flex flex-row flex-wrap gap-1.5 items-center min-w-0'>
        <span className='text-sm font-medium mr-1'>{party.name}</span>
        {maps.length > 0 ?
          <select aria-label={`${party.name} node`} className={selectClass} value={party.placeKey} onChange={(e) => choose(e.target.value)}>
            <option value=''>off the map</option>
            {maps.map((m) => (
              <optgroup key={m.id} label={m.name}>
                {m.nodes.map((n) => <option key={n.key} value={n.key}>{n.name}</option>)}
              </optgroup>
            ))}
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
      </Locked>
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
          <Button key={m.id} aria-label={m.name} disabled={m.out} selected={m.isActive} onClick={() => pick(m.id)}>{m.name} <span className='text-muted'>· {m.out ? 'in a fight' : m.plan}</span></Button>
        ))}
      </div>
      <Locked bar={partyBar} className='contents'>
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
              <NumberInput className='w-10' aria-label={`${g.kind} ${i + 1} DL`} {...barred(gmBar)} value={g.enteredDL} onChange={(e) => setGroup(party.id, g.id, { DL: parseInt(e.target.value) || 0 })} />
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
      </Locked>
    </div>
  )
}

// survival.tex "Exhaustion", "Rest", "Wear" — what the character will spend
// the coming ET on, and eating and drinking, which take no ET.
export function ExplorationSection(){

  const [nutrition, setNutrition] = useState(3)
  const { bar, options, cast, willDL, lastRoll, potion, foods, medicines } = useExploration()
  const { joinGroup, rest, planCast, setCast, eat, eatFood, drink, takeItem } = usePartyCommands()
  const closed = (plan: unknown) => plan === 'cast' && cast.ready === null

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Next exploration turn</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        {options.map((o) => (
          <Button key={o.label} aria-label={o.label} selected={o.selected} disabled={bar !== null || closed(o.plan)} title={bar ?? (closed(o.plan) ? 'no spell can be cast' : `${signed(o.IL)} IL, ${signed(o.exhaustion)} exhaustion${o.hunger ? `, ${signed(o.hunger)} hunger` : ''}${o.thirst ? `, ${signed(o.thirst)} thirst` : ''}${o.idle && o.plan ? ' (no healing rests left today)' : ''}`)}
            onClick={() => (o.plan === null ? rest(false) : o.plan === 'rest' ? rest(true) : o.plan === 'cast' ? (o.selected || cast.ready === null ? null : planCast(cast.ready)) : joinGroup(o.plan.group))}>{o.label}</Button>
        ))}
      </div>
      <CastPlanRow cast={cast} planCast={planCast} setCast={setCast} />
      {potion > 0 ? <span className='text-xs text-muted'>potion heals up to <span className='font-mono text-fg'>{potion}</span> IL over the ET</span> : null}
      {willDL !== null ? <span className='text-xs text-muted'>Will test DL <span className='font-mono text-fg'>{willDL}</span> opens the ET; a graze or miss forces a rest</span> : null}
      {lastRoll ? <span className='text-xs text-muted'>Will test last ET: <span className='font-mono text-fg'>{lastRoll.score}</span> vs DL <span className='font-mono text-fg'>{lastRoll.DL}</span>, {lastRoll.degree}</span> : null}
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-muted'>portion</span>
        <NumberInput className='w-12' aria-label='nutrition' value={nutrition} onChange={(e) => setNutrition(parseInt(e.target.value) || 0)} />
        <Button aria-label='eat' disabled={bar !== null} title={bar ?? undefined} onClick={() => eat(nutrition)}>eat</Button>
        <Button aria-label='drink' disabled={bar !== null} title={bar ?? undefined} onClick={drink}>drink water</Button>
      </div>
      {foods.length > 0 ?
        <div className='flex flex-row flex-wrap gap-1.5 items-center'>
          {foods.map((f) => (
            <Button key={f.id} aria-label={`eat ${f.name}`} disabled={bar !== null} title={bar ?? `${f.nutrition} hunger${f.charged ? ', charged' : ''}`} onClick={() => eatFood(f.id)}>
              eat {f.name}{f.charged ? ' ✦' : ''} <span className='text-muted'>×{f.amount}</span>
            </Button>
          ))}
        </div>
        : null}
      {medicines.length > 0 ?
        <div className='flex flex-row flex-wrap gap-1.5 items-center'>
          {medicines.map((m) => (
            <Button key={m.id} aria-label={`take ${m.name}`} disabled={bar !== null || m.bar !== null} title={bar ?? m.bar ?? undefined} onClick={() => takeItem(m.id)}>
              take {m.name} <span className='text-muted'>×{m.doses}</span>
            </Button>
          ))}
        </div>
        : null}
    </div>
  )
}

// spells.tex "Casting spells": the spell cast over the coming ET and what
// the table names for it.
function CastPlanRow({ cast, planCast, setCast }: { cast: CastPanel; planCast: (key: string) => void; setCast: (settings: Partial<Omit<CastPlan, 'key'>>) => void }){

  const plan = cast.plan
  if (!plan) return null
  const selected = plan.targets.filter((t) => t.selected).map((t) => t.id)

  return(
    <div className='flex flex-row flex-wrap gap-1.5 items-center'>
      <select aria-label='cast spell' className={selectClass} value={plan.key} onChange={(e) => planCast(e.target.value)}>
        {cast.spells.map((s) => <option key={s.key} value={s.key} disabled={s.reason !== null}>{s.name}{s.reason ? ` (${s.reason})` : ''}</option>)}
      </select>
      {plan.count === 1 ?
        <select aria-label='cast target' className={selectClass} value={selected[0] ?? ''} onChange={(e) => setCast({ targets: e.target.value ? [e.target.value] : [] })}>
          <option value=''>on…</option>
          {plan.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        : plan.count > 1 ?
        <span className='flex flex-row flex-wrap gap-1 items-center'>
          <span className='text-xs text-muted'>on (up to {plan.count})</span>
          {plan.targets.map((t) => (
            <label key={t.id} className='text-xs text-muted flex items-center gap-1'>
              <input type='checkbox' aria-label={`cast on ${t.name}`} checked={t.selected} onChange={(e) => setCast({ targets: e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id) })} />{t.name}
            </label>
          ))}
        </span>
        : null}
      {plan.wounds ?
        <select aria-label='cast wound' className={selectClass} value={plan.wound ?? ''} onChange={(e) => setCast({ wound: e.target.value === '' ? null : parseInt(e.target.value) })}>
          <option value=''>{plan.medicine ? 'wound…' : 'heals IL'}</option>
          {plan.wounds.map((w) => <option key={w.index} value={w.index}>{w.label}</option>)}
        </select>
        : null}
      {plan.limbs ?
        <select aria-label='cast limb' className={selectClass} value={plan.item} onChange={(e) => setCast({ item: e.target.value })}>
          <option value=''>limb…</option>
          {plan.limbs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        : null}
      {plan.foods ?
        <select aria-label='cast food' className={selectClass} value={plan.item} onChange={(e) => setCast({ item: e.target.value })}>
          <option value=''>into…</option>
          {plan.foods.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        : null}
      {plan.enteredDL !== null ?
        <>
          <span className='text-xs text-muted'>target DL</span>
          <NumberInput className='w-10' aria-label='cast target DL' value={plan.enteredDL} onChange={(e) => setCast({ DL: parseInt(e.target.value) || 0 })} />
        </>
        : null}
      {plan.enhance !== null ?
        <>
          <span className='text-xs text-muted'>enhance</span>
          <NumberInput className='w-10' aria-label='cast enhance' value={plan.enhance} onChange={(e) => setCast({ enhance: Math.max(0, parseInt(e.target.value) || 0) })} />
        </>
        : null}
      {plan.medicine ? null :
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label='cast effortless' checked={plan.effortless} onChange={(e) => setCast({ effortless: e.target.checked })} />effortless
        </label>}
      {plan.skill !== null && plan.DL !== null ?
        <span className='text-xs text-muted'>skill <span className='font-mono text-fg'>{plan.skill}</span> vs DL <span className='font-mono text-fg'>{plan.DL}</span> · +<span className='font-mono text-fg'>{plan.exhaustion}</span> exhaustion</span>
        : null}
    </div>
  )
}
