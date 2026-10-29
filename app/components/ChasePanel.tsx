'use client'
import { useState } from 'react'
import { Check, ChevronsRight, Dices, Flag, Footprints, GitMerge, Swords } from 'lucide-react'
import { ActionKey, Button, Closed, NumberInput, SectionLabel, TextInput, selectClass } from './ui'
import { useChase, useChaseCommands, useFollowScene } from '../hooks/useChase'
import type { ChaseCover, ChaseMove, ChaseTier, CrossingSkill } from '../domain/lists'
import type { ChasePanel as Panel, ChasePartyRow, ChaseSetupRow } from '../domain/scene/projections/chase'

const MOVE_LABELS: Record<ChaseMove, string> = { run: 'run', reverse: 'run the other way', shoot: 'shoot', hide: 'hide' }

// combat.tex "Escape": at the round change's chase step each party chooses to
// run away, to give chase to a party running away and from how far, or
// neither; the chase starts with the round. Whoever cannot run is named, with
// the press that leaves them behind so the others can.
export function ChaseSetup(){
  const chase = useChase()
  if (!chase.setup) return null

  return(
    <div className='flex flex-col gap-1.5 py-2 border-y border-line text-sm'>
      <SectionLabel>Run away or give chase</SectionLabel>
      {chase.setup.rows.map((row) => <SetupRow key={row.id} row={row} tiers={chase.tiers} />)}
      {chase.setup.startBar ? <span className='text-xs text-bad'>{chase.setup.startBar}</span> : null}
    </div>
  )
}

function SetupRow({ row, tiers }: { row: ChaseSetupRow; tiers: readonly ChaseTier[] }){
  const { choose, leaveBehind } = useChaseCommands()
  const chaseAt = (target: string, tier: ChaseTier) => choose(row.id, { kind: 'chase', target, tier })

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <span className='font-medium min-w-24'>{row.name}</span>
        <Closed reason={row.intent === 'run' ? null : row.runBar}>
          <ActionKey look={row.intent === 'run' ? 'picked' : 'plain'} icon={Footprints} aria-label={`run away ${row.name}`} aria-pressed={row.intent === 'run'} disabled={row.intent !== 'run' && row.runBar !== null}
            onClick={() => choose(row.id, row.intent === 'run' ? null : { kind: 'run' })}>run away</ActionKey>
        </Closed>
        <Closed reason={row.intent === 'chase' ? null : row.chaseBar}>
          <ActionKey look={row.intent === 'chase' ? 'picked' : 'plain'} icon={ChevronsRight} aria-label={`give chase ${row.name}`} aria-pressed={row.intent === 'chase'} disabled={row.intent !== 'chase' && row.chaseBar !== null}
            onClick={() => (row.intent === 'chase' ? choose(row.id, null) : chaseAt(row.targets[0].id, row.tier))}>give chase</ActionKey>
        </Closed>
        {row.intent === 'chase' ? (
          <span className='flex flex-row gap-1 items-center text-xs text-muted'>
            to
            <select className={selectClass} aria-label={`chase target ${row.name}`} value={row.target} onChange={(e) => chaseAt(e.target.value, row.tier)}>
              {row.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            from
            <select className={selectClass} aria-label={`chase tier ${row.name}`} value={row.tier} onChange={(e) => chaseAt(row.target, e.target.value as ChaseTier)}>
              {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
        ) : null}
        {row.intent === null ? <span className='text-xs text-muted'>stays out of the chase</span> : null}
      </div>
      {row.leaveBehind ? (
        <div className='flex flex-row flex-wrap gap-2 items-center pl-2 border-l-2 border-bad text-xs'>
          <span className='text-bad'>cannot run: {row.caught.join(', ')}</span>
          <Button aria-label={`leave behind ${row.name}`} tone='bad' size='xs' onClick={() => leaveBehind(row.id)}>leave {row.leaveBehind} behind</Button>
          <span className='text-muted'>they stay in a party of their own, out of the chase</span>
        </div>
      ) : null}
    </div>
  )
}

// combat.tex "Chases": the chain of who chases whom, what each party declares
// and how its run went, hiding, scouting and obstacles, cover, and who sets
// off to join a fight.
export function ChasePanel(){
  const chase = useChase()
  const { resolve, setCover } = useChaseCommands()
  if (!chase.chasing) return null

  return(
    <div className='flex flex-col gap-1 text-sm'>
      <div className='flex flex-row flex-wrap gap-3 items-center'>
        <SectionLabel>Chase</SectionLabel>
        <span className='text-xs text-muted'>time <span className='font-mono text-fg'>{chase.elapsed}</span></span>
        <span className='text-xs text-muted'>a round takes <span className='font-mono text-fg'>{chase.roundTakes}</span></span>
        {chase.fightFirst ? <span className='text-xs text-bad'>{chase.fightFirst}</span> : null}
        {chase.next ? <span className='text-xs text-accent'>next: {chase.next}</span> : null}
        {chase.roundBar ? <span className='text-xs text-muted'>next round: {chase.roundBar}</span> : null}
        <Closed reason={chase.resolveBar}><ActionKey look='go' icon={Dices} aria-label='resolveChase' disabled={chase.resolveBar !== null} onClick={resolve}>resolve the round</ActionKey></Closed>
      </div>
      {chase.placement ? <span className='text-xs text-muted'>placing: {chase.placement}</span> : null}
      {chase.order.length && !chase.resolved ? <span className='text-xs text-muted'>declaring order: <span className='text-fg'>{chase.order.join(' → ')}</span></span> : null}
      {chase.rolls.map((r, i) => (
        <span key={i} className='text-xs text-muted'>
          {r.kind} by <span className='text-fg'>{r.parties}</span>: <span className='font-mono'>{r.die}</span> → <span className='font-mono text-fg'>{r.score}</span> vs <span className='font-mono'>{r.DL}</span>, {r.degree}
          {r.found ? <span className='text-bad'> — {r.found} found</span> : null}
        </span>
      ))}
      {chase.rows.map((row) => <PartyRow key={row.id} row={row} chase={chase} />)}
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
        <span>cover</span>
        {chase.runners.map((r) => (
          <label key={r.id} className='flex gap-1 items-center'>
            {r.name}
            <select className={selectClass} aria-label={`cover ${r.name}`} value={r.cover ?? ''} onChange={(e) => setCover(r.id, (e.target.value || null) as ChaseCover | null)}>
              <option value=''>none</option>
              {chase.covers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}

function PartyRow({ row: p, chase }: { row: ChasePartyRow; chase: Panel }){
  const { declare, confirm, follow, putBack, giveUp, mergeBack, setFighting, join, cross, turnAround } = useChaseCommands()
  const [scouting, setScouting] = useState(false)
  const [what, setWhat] = useState('')
  const [scoutDL, setScoutDL] = useState(10)
  const [obstacle, setObstacle] = useState(false)
  const [hideModifier, setHideModifier] = useState(0)
  const [skill, setSkill] = useState<CrossingSkill>('climb')
  const [crossDL, setCrossDL] = useState(10)
  const [backTier, setBackTier] = useState<ChaseTier>('far')

  const declareMove = (move: ChaseMove) => declare(p.id, {
    move,
    scout: scouting && (move === 'run' || move === 'reverse') ? { what, DL: scoutDL, obstacle } : null,
    hideModifier: move === 'hide' ? hideModifier : 0,
  })

  return(
    <div className='flex flex-col gap-0.5 py-1 border-t border-line text-xs'>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
        <span className='text-fg font-medium'>{p.name}</span>
        <span className='text-muted'>{p.team}</span>
        <span className={p.out ? 'text-good' : p.fighting ? 'text-bad' : 'text-muted'}>{p.status}</span>
        {
          p.chases ?
          <span className='flex gap-1 items-center text-muted'>
            chases <span className='text-fg'>{p.chases.name}</span>{p.chases.enemy ? null : <span>(their team)</span>}
            {chase.tiers.map((t) => <span key={t} className={`px-1.5 rounded border ${t === p.chases!.tier ? 'border-accent text-accent' : 'border-line text-muted'}`}>{t}</span>)}
          </span>
          : null
        }
        {p.chasedBy.length ? <span className='text-muted'>chased by <span className='text-fg'>{p.chasedBy.join(', ')}</span></span> : null}
        {p.AP !== null ? <span className='text-muted'>skirmish <span className='font-mono text-fg'>{p.AP}</span> AP</span> : null}
        <Closed reason={p.fightBar}><ActionKey icon={p.fighting ? Footprints : Swords} aria-label={`${p.name} ${p.fighting ? 'runs again' : 'fights'}`} disabled={p.fightBar !== null} onClick={() => setFighting(p.id, !p.fighting)}>{p.fighting ? 'run again' : 'fight'}</ActionKey></Closed>
        {p.mergeBar !== null || p.chases && !p.chases.enemy ? <Closed reason={p.mergeBar}><ActionKey icon={GitMerge} aria-label={`${p.name} merges back`} disabled={p.mergeBar !== null} onClick={() => mergeBack(p.id)}>merge back</ActionKey></Closed> : null}
        {p.chases ? <Closed reason={p.giveUpBar}><ActionKey icon={Flag} aria-label={`${p.name} gives up`} disabled={p.giveUpBar !== null} onClick={() => giveUp(p.id)}>give up</ActionKey></Closed> : null}
      </div>
      {
        p.declares ?
        <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center text-muted'>
          <span>declares</span>
          {p.moves.map(({ move, bar }) => (
            <Closed key={move} reason={bar}><ActionKey look={p.declaration?.move === move ? 'picked' : 'plain'} aria-label={`${p.name} ${move}`} disabled={bar !== null} onClick={() => declareMove(move)}>{MOVE_LABELS[move]}</ActionKey></Closed>
          ))}
          <Closed reason={p.scoutBar}>
            <label className='flex gap-1 items-center'>
              <input type='checkbox' aria-label={`${p.name} scouts`} disabled={p.scoutBar !== null} checked={scouting} onChange={() => setScouting(!scouting)} />
              scout for
            </label>
          </Closed>
          {scouting ? <>
            <TextInput className='w-32' aria-label={`${p.name} scouts for`} value={what} onChange={(e) => setWhat(e.target.value)} />
            DL <NumberInput className='w-10' aria-label={`${p.name} scout DL`} value={scoutDL} onChange={(e) => setScoutDL(Number(e.target.value))} />
            <label className='flex gap-1 items-center'><input type='checkbox' aria-label={`${p.name} scouts an obstacle`} checked={obstacle} onChange={() => setObstacle(!obstacle)} />obstacle</label>
          </> : null}
          hide modifier <NumberInput className='w-10' aria-label={`${p.name} hide modifier`} value={hideModifier} onChange={(e) => setHideModifier(Number(e.target.value))} />
          {p.declaration ? <span className='text-fg'>— {MOVE_LABELS[p.declaration.move]}{p.declaration.scout ? `, scouting for ${p.declaration.scout.what || 'a place'}` : ''}</span> : null}
          <Closed reason={p.confirmed ? null : p.confirmBar}>
            <ActionKey look={p.confirmed ? 'picked' : 'plain'} icon={Check} aria-label={`${p.name} confirms`} disabled={p.confirmBar !== null} onClick={() => confirm(p.id)}>
              {p.confirmed ? 'confirmed' : 'confirm'}
            </ActionKey>
          </Closed>
        </div>
        : null
      }
      {
        p.turnable ?
        <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-muted'>
          <span>turn around</span>
          {p.members.map((m) => (
            <label key={m.id} className='flex gap-1 items-center'>
              <input type='checkbox' aria-label={`turn around ${m.name}`} checked={m.turned} onChange={() => turnAround(m.id)} />
              {m.name}
            </label>
          ))}
        </div>
        : null
      }
      {p.caught.map((reason) => <span key={reason} className='text-bad'>caught: {reason}</span>)}
      {
        p.run ?
        <div className='flex flex-col gap-0.5 text-muted'>
          <span>
            {p.run.skirmish ? 'skirmish' : 'run'} at {p.run.tier}
            {p.run.contest ? <>: chaser <span className='font-mono text-fg'>{p.run.chaser}</span>, chased <span className='font-mono text-fg'>{p.run.chased}</span> — {p.run.winner} wins</> : null}
            {p.run.coin !== null ? <> (draw settled by <span className='font-mono'>{p.run.coin}</span>)</> : null}
            {' — '}{p.run.way === 'close' ? 'closing in' : p.run.way === 'open' ? 'pulling away' : 'no change'}{p.run.skirmish && p.run.way ? ' at the end of the round' : ''}
          </span>
          {p.run.contest ? (
            <span className='flex flex-row flex-wrap gap-x-3'>
              {p.run.runners.map((r) => <span key={r.id} className={r.slowest ? 'text-fg' : undefined}>{r.name} ({r.role}) <span className='font-mono'>{r.speed}</span></span>)}
            </span>
          ) : null}
        </div>
        : null
      }
      {
        p.feature ?
        <span className='text-muted'>
          found <span className='text-fg'>{p.feature.what || 'a place'}</span>{p.feature.obstacle ? ' (obstacle)' : ''}: {p.feature.reached ? 'reached' : `at ${p.feature.tier}`}
        </span>
        : null
      }
      {
        p.crossBar !== null || p.feature?.reached && p.feature.obstacle ?
        <div className='flex flex-row flex-wrap gap-x-2 items-center text-muted'>
          cross with
          <select className={selectClass} aria-label={`${p.name} crossing skill`} value={skill} onChange={(e) => setSkill(e.target.value as CrossingSkill)}>
            {chase.crossingSkills.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          DL <NumberInput className='w-10' aria-label={`${p.name} crossing DL`} value={crossDL} onChange={(e) => setCrossDL(Number(e.target.value))} />
          <Closed reason={p.crossBar}><ActionKey aria-label={`${p.name} crosses`} disabled={p.crossBar !== null} onClick={() => cross(p.id, skill, crossDL)}>cross</ActionKey></Closed>
        </div>
        : null
      }
      <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center text-muted'>
        {p.followOptions.map((o) => (
          <Closed key={o.id} reason={o.bar}><ActionKey icon={ChevronsRight} aria-label={`${p.name} chases ${o.name}`} disabled={o.bar !== null} onClick={() => follow(p.id, o.id)}>chase {o.name}</ActionKey></Closed>
        ))}
        {p.joining ? <span>joining the fight of {p.joining} at the end of the round</span> : null}
        {p.joinOptions.map((o) => (
          <Closed key={o.id} reason={o.bar}><ActionKey icon={Swords} aria-label={`${p.name} joins ${o.name}`} disabled={o.bar !== null} onClick={() => join(p.id, o.id)}>join the fight of {o.name}</ActionKey></Closed>
        ))}
        {p.putBackOptions.length ? <>
          put back at
          <select className={selectClass} aria-label={`${p.name} put back tier`} value={backTier} onChange={(e) => setBackTier(e.target.value as ChaseTier)}>
            {chase.tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {p.putBackOptions.map((o) => (
            <Closed key={o.id} reason={o.bar}><ActionKey aria-label={`${p.name} put back chasing ${o.name}`} disabled={o.bar !== null} onClick={() => putBack(p.id, o.id, backTier)}>chasing {o.name}</ActionKey></Closed>
          ))}
        </> : null}
      </div>
    </div>
  )
}

// Once a chase is over, the party the scene follows; the others are parked
// off the grid until the table follows them instead.
export function FollowPanel(){
  const { panel, follow } = useFollowScene()
  if (!panel) return null

  return(
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
      {panel.following ? <span>following <span className='text-fg'>{panel.following}</span>; the others are parked off the grid</span> : <span className='text-accent'>the chase is over: follow</span>}
      {panel.options.map((o) => (
        <Closed key={o.id} reason={o.bar}><Button size='xs' aria-label={`follow ${o.name}`} disabled={o.bar !== null} onClick={() => follow(o.id)}>{panel.following ? 'follow ' : ''}{o.name}</Button></Closed>
      ))}
    </div>
  )
}
