'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, TextInput, selectClass } from './ui'
import { useChase, useChaseCommands } from '../hooks/useChase'
import type { ChaseCover, ChaseMove, ChaseTier, CrossingSkill } from '../domain/lists'
import type { ChasePanel as Panel, ChasePartyRow } from '../domain/scene/projections/chase'

const MOVE_LABELS: Record<ChaseMove, string> = { run: 'run', reverse: 'run the other way', shoot: 'shoot', hide: 'hide' }

// combat.tex "Chases": who runs away and from how far, said before the chase
// begins.
export function ChaseSetup(){
  const [quarry, setQuarry] = useState<string[]>([])
  const [startTier, setStartTier] = useState<ChaseTier>('combat')
  const chase = useChase(quarry, startTier)
  const { startChase } = useChaseCommands()
  if (chase.parties.length === 0 || chase.chasing) return null

  const toggle = (id: string) => setQuarry(quarry.includes(id) ? quarry.filter((q) => q !== id) : [...quarry, id])

  return(
    <div className='flex flex-col gap-1 text-sm'>
      {chase.next ? <span className='text-xs text-accent'>next: {chase.next}</span> : null}
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
        <span>running away</span>
        {chase.parties.map((p) => (
          <label key={p.id} className='flex gap-1 items-center'>
            <input type='checkbox' aria-label={`quarry ${p.name}`} checked={quarry.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}
          </label>
        ))}
        <select className={selectClass} aria-label='starting tier' value={startTier} onChange={(e) => setStartTier(e.target.value as ChaseTier)}>
          {chase.tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button size='xs' aria-label='startChase' disabled={chase.startBar !== null} title={chase.startBar ?? undefined} onClick={() => startChase(quarry, startTier)}>start chase</Button>
        {chase.startBar ? <span>{chase.startBar}</span> : null}
      </div>
    </div>
  )
}

// combat.tex "Chases": the chain of who chases whom, what each party declares
// and how its run went, hiding, scouting and obstacles, cover, and who sets
// off to join a fight.
export function ChasePanel(){
  const chase = useChase([], 'combat')
  const { endChase, resolve, setCover } = useChaseCommands()
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
        <Button size='xs' aria-label='resolveChase' disabled={chase.resolveBar !== null} title={chase.resolveBar ?? undefined} onClick={resolve}>resolve the round</Button>
        <Button size='xs' aria-label='endChase' disabled={chase.endBar !== null} title={chase.endBar ?? undefined} onClick={endChase}>end chase</Button>
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
  const { declare, follow, putBack, giveUp, mergeBack, runOn, setFighting, join, cross, turnAround } = useChaseCommands()
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
        <Button size='xs' variant='ghost' aria-label={`${p.name} ${p.fighting ? 'runs again' : 'fights'}`} disabled={p.fightBar !== null} title={p.fightBar ?? undefined} onClick={() => setFighting(p.id, !p.fighting)}>{p.fighting ? 'run again' : 'fight'}</Button>
        {p.mergeBar !== null || p.chases && !p.chases.enemy ? <Button size='xs' variant='ghost' aria-label={`${p.name} merges back`} disabled={p.mergeBar !== null} title={p.mergeBar ?? undefined} onClick={() => mergeBack(p.id)}>merge back</Button> : null}
        {p.chases ? <Button size='xs' variant='ghost' aria-label={`${p.name} gives up`} disabled={p.giveUpBar !== null} title={p.giveUpBar ?? undefined} onClick={() => giveUp(p.id)}>give up</Button> : null}
        {p.separated ? <Button size='xs' aria-label={`${p.name} runs on`} onClick={() => runOn(p.id)}>run on</Button> : null}
      </div>
      {
        p.declares ?
        <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center text-muted'>
          <span>declares</span>
          {p.moves.map(({ move, bar }) => (
            <Button key={move} size='xs' variant={p.declaration?.move === move ? 'primary' : 'default'} active={p.declaration?.move === move} aria-label={`${p.name} ${move}`} disabled={bar !== null} title={bar ?? undefined} onClick={() => declareMove(move)}>{MOVE_LABELS[move]}</Button>
          ))}
          <label className='flex gap-1 items-center' title={p.scoutBar ?? undefined}>
            <input type='checkbox' aria-label={`${p.name} scouts`} disabled={p.scoutBar !== null} checked={scouting} onChange={() => setScouting(!scouting)} />
            scout for
          </label>
          {scouting ? <>
            <TextInput className='w-32' aria-label={`${p.name} scouts for`} value={what} onChange={(e) => setWhat(e.target.value)} />
            DL <NumberInput className='w-10' aria-label={`${p.name} scout DL`} value={scoutDL} onChange={(e) => setScoutDL(Number(e.target.value))} />
            <label className='flex gap-1 items-center'><input type='checkbox' aria-label={`${p.name} scouts an obstacle`} checked={obstacle} onChange={() => setObstacle(!obstacle)} />obstacle</label>
          </> : null}
          hide modifier <NumberInput className='w-10' aria-label={`${p.name} hide modifier`} value={hideModifier} onChange={(e) => setHideModifier(Number(e.target.value))} />
          {p.declaration ? <span className='text-fg'>— {MOVE_LABELS[p.declaration.move]}{p.declaration.scout ? `, scouting for ${p.declaration.scout.what || 'a place'}` : ''}</span> : null}
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
          <Button size='xs' aria-label={`${p.name} crosses`} disabled={p.crossBar !== null} title={p.crossBar ?? undefined} onClick={() => cross(p.id, skill, crossDL)}>cross</Button>
        </div>
        : null
      }
      <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center text-muted'>
        {p.followOptions.map((o) => (
          <Button key={o.id} size='xs' variant='ghost' aria-label={`${p.name} chases ${o.name}`} disabled={o.bar !== null} title={o.bar ?? undefined} onClick={() => follow(p.id, o.id)}>chase {o.name}</Button>
        ))}
        {p.joining ? <span>joining the fight of {p.joining} at the end of the round</span> : null}
        {p.joinOptions.map((o) => (
          <Button key={o.id} size='xs' variant='ghost' aria-label={`${p.name} joins ${o.name}`} disabled={o.bar !== null} title={o.bar ?? undefined} onClick={() => join(p.id, o.id)}>join the fight of {o.name}</Button>
        ))}
        {p.putBackOptions.length ? <>
          put back at
          <select className={selectClass} aria-label={`${p.name} put back tier`} value={backTier} onChange={(e) => setBackTier(e.target.value as ChaseTier)}>
            {chase.tiers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {p.putBackOptions.map((o) => (
            <Button key={o.id} size='xs' variant='ghost' aria-label={`${p.name} put back chasing ${o.name}`} disabled={o.bar !== null} title={o.bar ?? undefined} onClick={() => putBack(p.id, o.id, backTier)}>chasing {o.name}</Button>
          ))}
        </> : null}
      </div>
    </div>
  )
}
