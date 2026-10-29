'use client'
import { Fragment, useState } from 'react'
import { Check, ChevronsRight, Dices, Flag, Footprints, GitMerge, Swords } from 'lucide-react'
import { GmLocked } from './Locks'
import { ActionKey, Button, Closed, NumberInput, SectionLabel, Segment, Segmented, TextInput, selectClass } from './ui'
import { useChase, useChaseCommands, useFollowScene } from '../hooks/useChase'
import type { ChaseCover, ChaseMove, ChaseSide, ChaseTier, CrossingSkill } from '../domain/lists'
import type { ChasePanel as Panel, ChasePartyRow, ChaseRunRow, ChaseSetupRow } from '../domain/scene/projections/chase'

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

// The GM's press at the round change's chase step that ends the fight living
// in the chase and takes the chase up again with the round.
export function BackToChase(){
  const chase = useChase()
  const { backToChase } = useChaseCommands()
  if (!chase.saved) return null

  return(
    <div className='flex flex-row flex-wrap gap-2 items-center py-2 border-y border-line text-xs text-muted'>
      <span>{chase.saved.fighting} fighting in the saved chase</span>
      <GmLocked>
        <Closed reason={chase.saved.backBar}><ActionKey icon={Footprints} aria-label='backToChase' disabled={chase.saved.backBar !== null} onClick={backToChase}>end the fight, back to the chase</ActionKey></Closed>
      </GmLocked>
      <span>or fight another round</span>
    </div>
  )
}

// The chase while a fight lives in it (the table's ruling): saved and
// frozen, drawn as it stands below.
export function ChaseSaved(){
  const { saved } = useChase()
  if (!saved) return null

  return(
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center rounded border border-line bg-surface px-2 py-1.5 text-xs text-muted'>
      <SectionLabel>Chase saved</SectionLabel>
      <span><span className='text-fg'>{saved.fighting}</span> fighting; everyone else is frozen until they join at a round change or the GM ends the fight</span>
    </div>
  )
}

// combat.tex "Combat with split group": at the round change's join step, each
// party the fight in the chase froze may join it from shooting range.
export function JoinChaseFight(){
  const { saved } = useChase()
  const { join } = useChaseCommands()
  if (!saved || saved.parties.length === 0) return null

  return(
    <div className='flex flex-col gap-1 py-2 border-y border-line text-xs'>
      <div className='flex flex-row flex-wrap gap-x-3 items-baseline'>
        <SectionLabel>Join from the chase</SectionLabel>
        <span className='text-muted'>placed {saved.arriving}</span>
      </div>
      {saved.parties.map((p) => (
        <div key={p.id} className='flex flex-row flex-wrap gap-2 items-center'>
          <span className='font-medium min-w-24'>{p.name}</span>
          {p.options.map((o) => (
            <Closed key={o.id} reason={o.bar}><ActionKey icon={Swords} aria-label={`${p.name} joins ${o.name}`} disabled={o.bar !== null} onClick={() => join(p.id, o.id)}>join the fight of {o.name}</ActionKey></Closed>
          ))}
        </div>
      ))}
    </div>
  )
}

const TEAM_EDGE: Record<ChaseSide, string> = { pursuers: 'border-l-bad', quarry: 'border-l-accent' }
const TEAM_TEXT: Record<ChaseSide, string> = { pursuers: 'text-bad', quarry: 'text-accent' }

// combat.tex "Chases": the round as the table plays it, what to do next and
// the tests it made, then a card for each party: who it chases, its members,
// what it declares, how its run went, the places it found and what the table
// may do with it.
export function ChasePanel(){
  const chase = useChase()
  const { resolve } = useChaseCommands()
  if (!chase.chasing) return null

  return(
    <div className='flex flex-col gap-2 text-sm'>
      <div className='flex flex-col gap-1.5 rounded border border-line bg-surface p-2'>
        <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center'>
          <SectionLabel>Chase</SectionLabel>
          <span className='text-xs text-muted'>time <span className='font-mono text-fg'>{chase.elapsed}</span></span>
          <span className='text-xs text-muted'>a round takes <span className='font-mono text-fg'>{chase.roundTakes}</span></span>
          <span className='ml-auto'>
            <Closed reason={chase.resolveBar}><ActionKey look='go' icon={Dices} aria-label='resolveChase' disabled={chase.resolveBar !== null} onClick={resolve}>resolve the round</ActionKey></Closed>
          </span>
        </div>
        {chase.next ? <span className='rounded border-l-2 border-accent bg-accent/10 px-2 py-1 text-xs text-fg'><span className='font-semibold text-accent'>next </span>{chase.next}</span> : null}
        {chase.order.length && !chase.resolved ? <span className='text-xs text-muted'>declaring order: <span className='text-fg'>{chase.order.join(' → ')}</span></span> : null}
        {chase.roundBar ? <span className='text-xs text-muted'>next round: {chase.roundBar}</span> : null}
        {chase.placement ? <span className='text-xs text-muted'>placing: {chase.placement}</span> : null}
        {chase.rolls.length ? (
          <div className='flex flex-col gap-0.5 border-t border-line pt-1 text-xs text-muted'>
            {chase.rolls.map((r, i) => (
              <span key={i}>
                {r.kind} by <span className='text-fg'>{r.parties}</span>: <span className='font-mono'>{r.die}</span> → <span className='font-mono text-fg'>{r.score}</span> vs <span className='font-mono'>{r.DL}</span>, {r.degree}
                {r.found ? <span className='text-bad'>, {r.found} found</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className='grid gap-2 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]'>
        {chase.rows.map((row) => <PartyCard key={row.id} row={row} chase={chase} />)}
      </div>
    </div>
  )
}

function PartyCard({ row: p, chase }: { row: ChasePartyRow; chase: Panel }){
  const { follow, putBack, giveUp, mergeBack } = useChaseCommands()
  const [backTier, setBackTier] = useState<ChaseTier>('far')
  const merges = p.mergeBar !== null || (p.chases !== null && !p.chases.enemy)
  const acts = merges || p.chases !== null || p.followOptions.length > 0 || p.putBackOptions.length > 0

  return(
    <div className={`flex flex-col gap-2 rounded-md border border-line border-l-4 bg-surface p-2 text-xs ${TEAM_EDGE[p.team]} ${p.out ? 'opacity-70' : ''}`}>
      <div className='flex flex-col gap-0.5'>
        <div className='flex flex-row flex-wrap gap-x-2 items-baseline'>
          <span className='text-sm font-semibold text-fg'>{p.name}</span>
          <span className={`text-[10px] uppercase tracking-wide ${TEAM_TEXT[p.team]}`}>{p.team}</span>
          <span className={`ml-auto rounded border px-1.5 ${p.out ? 'border-good text-good' : p.fighting ? 'border-bad text-bad' : 'border-line text-muted'}`}>{p.status}</span>
        </div>
        <div className='flex flex-row flex-wrap gap-x-3 text-muted'>
          {p.chases ? <span>chases <span className='text-fg'>{p.chases.name}</span>{p.chases.enemy ? null : ' (their team)'}</span> : null}
          {p.chasedBy.length ? <span>chased by <span className='text-fg'>{p.chasedBy.join(', ')}</span></span> : null}
          {p.AP !== null ? <span>skirmish <span className='font-mono text-fg'>{p.AP}</span> AP</span> : null}
        </div>
      </div>
      <Members row={p} covers={chase.covers} />
      {p.caught.map((reason) => <span key={reason} className='text-bad'>caught: {reason}</span>)}
      {p.declares ? <Declare row={p} /> : null}
      {p.run ? <Run run={p.run} /> : null}
      {p.feature || p.crossBar !== null ? <Feature row={p} chase={chase} /> : null}
      {acts ? (
        <div className='flex flex-row flex-wrap gap-1.5 items-center border-t border-line pt-1.5 text-muted'>
          {merges ? <Closed reason={p.mergeBar}><ActionKey icon={GitMerge} aria-label={`${p.name} merges back`} disabled={p.mergeBar !== null} onClick={() => mergeBack(p.id)}>merge back</ActionKey></Closed> : null}
          {p.chases ? <Closed reason={p.giveUpBar}><ActionKey icon={Flag} aria-label={`${p.name} gives up`} disabled={p.giveUpBar !== null} onClick={() => giveUp(p.id)}>give up</ActionKey></Closed> : null}
          {p.followOptions.map((o) => (
            <Closed key={o.id} reason={o.bar}><ActionKey icon={ChevronsRight} aria-label={`${p.name} chases ${o.name}`} disabled={o.bar !== null} onClick={() => follow(p.id, o.id)}>chase {o.name}</ActionKey></Closed>
          ))}
          {p.putBackOptions.length ? (
            <span className='flex flex-row flex-wrap gap-1.5 items-center'>
              put back at
              <select className={selectClass} aria-label={`${p.name} put back tier`} value={backTier} onChange={(e) => setBackTier(e.target.value as ChaseTier)}>
                {chase.tiers.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {p.putBackOptions.map((o) => (
                <Closed key={o.id} reason={o.bar}><ActionKey aria-label={`${p.name} put back chasing ${o.name}`} disabled={o.bar !== null} onClick={() => putBack(p.id, o.id, backTier)}>chasing {o.name}</ActionKey></Closed>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// combat.tex "Catching", "Cover": each member, whether they turned around to
// face the chasers, and the cover the table gives them.
function Members({ row: p, covers }: { row: ChasePartyRow; covers: readonly ChaseCover[] }){
  const { turnAround, setCover } = useChaseCommands()
  if (p.members.length === 0) return null

  return(
    <div className='grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 items-center'>
      <span className='text-[10px] uppercase tracking-wide text-muted'>member</span>
      <span className='text-[10px] uppercase tracking-wide text-muted'>{p.turnable ? 'turned around' : ''}</span>
      <span className='text-[10px] uppercase tracking-wide text-muted'>cover</span>
      {p.members.map((m) => (
        <Fragment key={m.id}>
          <span className='truncate text-fg'>{m.name}</span>
          <span className='justify-self-center'>
            {p.turnable ? <input type='checkbox' aria-label={`turn around ${m.name}`} checked={m.turned} onChange={() => turnAround(m.id)} /> : null}
          </span>
          <select className={selectClass} aria-label={`cover ${m.name}`} value={m.cover ?? ''} onChange={(e) => setCover(m.id, (e.target.value || null) as ChaseCover | null)}>
            <option value=''>none</option>
            {covers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Fragment>
      ))}
    </div>
  )
}

// combat.tex "Chase actions": the move the party declares this round, with
// the scouting a run may carry and the modifier a hide is tested at, then
// the confirmation.
function Declare({ row: p }: { row: ChasePartyRow }){
  const { declare, confirm } = useChaseCommands()
  const [scouting, setScouting] = useState(false)
  const [what, setWhat] = useState('')
  const [scoutDL, setScoutDL] = useState(10)
  const [obstacle, setObstacle] = useState(false)
  const [hideModifier, setHideModifier] = useState(0)

  const declareMove = (move: ChaseMove) => declare(p.id, {
    move,
    scout: scouting && (move === 'run' || move === 'reverse') ? { what, DL: scoutDL, obstacle } : null,
    hideModifier: move === 'hide' ? hideModifier : 0,
  })

  return(
    <div className='flex flex-col gap-1.5 rounded border border-line bg-raised/40 p-1.5'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <SectionLabel>declares</SectionLabel>
        <Segmented label={`${p.name} declares`}>
          {p.moves.map(({ move, bar }) => (
            <Segment key={move} aria-label={`${p.name} ${move}`} selected={p.declaration?.move === move} disabled={bar !== null} title={bar ?? undefined} onClick={() => declareMove(move)}>{MOVE_LABELS[move]}</Segment>
          ))}
        </Segmented>
        <span className='ml-auto'>
          <Closed reason={p.confirmed ? null : p.confirmBar}>
            <ActionKey look={p.confirmed ? 'picked' : 'plain'} icon={Check} aria-label={`${p.name} confirms`} disabled={p.confirmBar !== null} onClick={() => confirm(p.id)}>
              {p.confirmed ? 'confirmed' : 'confirm'}
            </ActionKey>
          </Closed>
        </span>
      </div>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-muted'>
        <Closed reason={p.scoutBar}>
          <label className='flex gap-1 items-center'>
            <input type='checkbox' aria-label={`${p.name} scouts`} disabled={p.scoutBar !== null} checked={scouting} onChange={() => setScouting(!scouting)} />
            scout while running
          </label>
        </Closed>
        {scouting ? (
          <span className='flex flex-row flex-wrap gap-1 items-center'>
            for <TextInput className='w-28' aria-label={`${p.name} scouts for`} value={what} onChange={(e) => setWhat(e.target.value)} />
            DL <NumberInput className='w-10' aria-label={`${p.name} scout DL`} value={scoutDL} onChange={(e) => setScoutDL(Number(e.target.value))} />
            <label className='flex gap-1 items-center'><input type='checkbox' aria-label={`${p.name} scouts an obstacle`} checked={obstacle} onChange={() => setObstacle(!obstacle)} />obstacle</label>
          </span>
        ) : null}
        <span className='flex gap-1 items-center'>hide modifier <NumberInput className='w-10' aria-label={`${p.name} hide modifier`} value={hideModifier} onChange={(e) => setHideModifier(Number(e.target.value))} /></span>
      </div>
      {p.declaration?.scout ? <span className='text-fg'>scouting for {p.declaration.scout.what || 'a place'}</span> : null}
    </div>
  )
}

// How the party's link ran this round: the contest, each runner's speed with
// the slowest of each side lit, and which way it went.
function Run({ run }: { run: ChaseRunRow }){
  return(
    <div className='flex flex-col gap-0.5 border-t border-line pt-1.5 text-muted'>
      <span>
        <span className='text-fg'>{run.skirmish ? 'skirmish' : 'run'}</span> at {run.tier}
        {run.contest ? <>: chaser <span className='font-mono text-fg'>{run.chaser}</span>, chased <span className='font-mono text-fg'>{run.chased}</span>, {run.winner} wins</> : null}
        {run.coin !== null ? <> (draw settled by <span className='font-mono'>{run.coin}</span>)</> : null}
      </span>
      <span className='text-fg'>{run.way === 'close' ? 'closing in' : run.way === 'open' ? 'pulling away' : 'no change'}{run.skirmish && run.way ? ' at the end of the round' : ''}</span>
      {run.contest ? (
        <span className='flex flex-row flex-wrap gap-x-3'>
          {run.runners.map((r) => <span key={r.id} className={r.slowest ? 'text-fg' : undefined}>{r.name} ({r.role}) <span className='font-mono'>{r.speed}</span></span>)}
        </span>
      ) : null}
    </div>
  )
}

// combat.tex "Scouting", "Obstacle": the place the party found and, once an
// obstacle is reached, the test that crosses it.
function Feature({ row: p, chase }: { row: ChasePartyRow; chase: Panel }){
  const { cross } = useChaseCommands()
  const [skill, setSkill] = useState<CrossingSkill>('climb')
  const [crossDL, setCrossDL] = useState(10)

  return(
    <div className='flex flex-col gap-1 border-t border-line pt-1.5 text-muted'>
      {p.feature ? <span>found <span className='text-fg'>{p.feature.what || 'a place'}</span>{p.feature.obstacle ? ' (obstacle)' : ''}: {p.feature.reached ? 'reached' : `at ${p.feature.tier}`}</span> : null}
      {p.crossBar !== null || (p.feature?.reached && p.feature.obstacle) ? (
        <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center'>
          cross with
          <select className={selectClass} aria-label={`${p.name} crossing skill`} value={skill} onChange={(e) => setSkill(e.target.value as CrossingSkill)}>
            {chase.crossingSkills.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          DL <NumberInput className='w-10' aria-label={`${p.name} crossing DL`} value={crossDL} onChange={(e) => setCrossDL(Number(e.target.value))} />
          <Closed reason={p.crossBar}><ActionKey aria-label={`${p.name} crosses`} disabled={p.crossBar !== null} onClick={() => cross(p.id, skill, crossDL)}>cross</ActionKey></Closed>
        </div>
      ) : null}
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
