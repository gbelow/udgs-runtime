'use client'
import { useState } from 'react'
import { Button, SectionLabel, selectClass } from './ui'
import { useChase, useChaseCommands } from '../hooks/useChase'
import type { ChaseCover, ChaseTier, SkirmishStance } from '../domain/lists'
import type { ChaseGroupRow, ChasePartyRow } from '../domain/scene/projections/chase'

// combat.tex "Chases": who runs away and from how far, each group's run and
// which way its winner takes the distance, who follows whom, skirmishes,
// cover and who sets off to join a fight.
export function ChasePanel(){
  const [quarry, setQuarry] = useState<string[]>([])
  const [startTier, setStartTier] = useState<ChaseTier>('combat')
  const chase = useChase(quarry, startTier)
  const { startChase, endChase, setCover } = useChaseCommands()
  if (chase.parties.length === 0) return null

  const toggle = (id: string) => setQuarry(quarry.includes(id) ? quarry.filter((q) => q !== id) : [...quarry, id])

  return(
    <div className='flex flex-col gap-1 py-2 border-b border-line text-sm'>
      <div className='flex flex-row flex-wrap gap-3 items-center'>
        <SectionLabel>Chase</SectionLabel>
        <span className='text-xs text-muted'>time <span className='font-mono text-fg'>{chase.elapsed}</span></span>
        {chase.chasing ? <span className='text-xs text-muted'>a round takes <span className='font-mono text-fg'>{chase.roundTakes}</span></span> : null}
        {chase.fightFirst ? <span className='text-xs text-bad'>{chase.fightFirst}</span> : null}
        {chase.chasing ? <Button size='xs' aria-label='endChase' disabled={chase.endBar !== null} title={chase.endBar ?? undefined} onClick={endChase}>end chase</Button> : null}
      </div>
      {
        !chase.chasing ?
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
        :
        <>
          {chase.groups.map((g) => <GroupRow key={g.id} group={g} tiers={chase.tiers} />)}
          <div className='flex flex-col gap-0.5 text-xs text-muted'>
            {chase.chaseParties.map((p) => <PartyRow key={p.id} party={p} stances={chase.stances} />)}
          </div>
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
        </>
      }
    </div>
  )
}

function GroupRow({ group: g, tiers }: { group: ChaseGroupRow; tiers: readonly ChaseTier[] }){
  const { run, choose, setFighting, turnAround } = useChaseCommands()
  return(
    <div className='flex flex-col gap-0.5 py-1 border-t border-line text-xs'>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
        <span className='text-fg font-medium'>{g.name}</span>
        <span className='flex gap-1'>
          {tiers.map((t) => <span key={t} className={`px-1.5 rounded border ${t === g.tier ? 'border-accent text-accent' : 'border-line text-muted'}`}>{t}</span>)}
        </span>
        {
          g.escaped ? <span className='text-good'>got away</span> :
          g.fighting ? <span className='text-bad'>caught, fighting</span> :
          g.followers.length ? <span className='text-muted'>followed by <span className='text-fg'>{g.followers.join(', ')}</span></span> :
          <span className='text-muted'>nobody follows them ({g.unfollowed} {g.unfollowed === 1 ? 'round' : 'rounds'})</span>
        }
        <Button size='xs' aria-label={`run ${g.name}`} disabled={g.runBar !== null} title={g.runBar ?? undefined} onClick={() => run(g.id)}>run</Button>
        {g.ways.map((way) => (
          <Button key={way} size='xs' aria-label={`${g.name} ${way} the distance`} onClick={() => choose(g.id, way)}>{way === 'close' ? 'close in' : 'pull away'}</Button>
        ))}
        <Button size='xs' variant='ghost' aria-label={`${g.name} ${g.fighting ? 'runs again' : 'fights'}`} disabled={g.fightBar !== null} title={g.fightBar ?? undefined} onClick={() => setFighting(g.id, !g.fighting)}>{g.fighting ? 'run again' : 'fight'}</Button>
      </div>
      {
        !g.escaped && !g.fighting ?
        <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-muted'>
          <span>turn around</span>
          {g.members.map((m) => (
            <label key={m.id} className='flex gap-1 items-center'>
              <input type='checkbox' aria-label={`turn around ${m.name}`} checked={m.turned} onChange={() => turnAround(m.id)} />
              {m.name}
            </label>
          ))}
        </div>
        : null
      }
      {g.runBar && !g.run && !g.caught.length && !g.escaped && !g.fighting ? <span className='text-muted'>cannot run: {g.runBar}</span> : null}
      {g.caught.map((reason) => <span key={reason} className='text-bad'>caught: {reason}</span>)}
      {
        g.run ?
        <div className='flex flex-col gap-0.5 text-muted'>
          <span>
            run at {g.run.tier}: quarry <span className='font-mono text-fg'>{g.run.quarry}</span>, pursuers <span className='font-mono text-fg'>{g.run.pursuers}</span>
            {' — '}{g.run.winner === 'draw' ? 'a draw' : `${g.run.winner} win`}
            {g.run.coin !== null ? <> (draw settled by <span className='font-mono'>{g.run.coin}</span>)</> : null}
          </span>
          <span className='flex flex-row flex-wrap gap-x-3'>
            {g.run.runners.map((r) => (
              <span key={r.id} className={r.slowest ? 'text-fg' : undefined}>{r.name} ({r.side}) <span className='font-mono'>{r.speed}</span></span>
            ))}
          </span>
        </div>
        : null
      }
    </div>
  )
}

function PartyRow({ party: p, stances }: { party: ChasePartyRow; stances: readonly SkirmishStance[] }){
  const { follow, chooseStance, join } = useChaseCommands()
  return(
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
      <span className='text-fg'>{p.name}</span>
      <span>{p.side}</span>
      {p.side === 'pursuers' ? <span>follows <span className='text-fg'>{p.follows ?? 'nobody'}</span></span> : null}
      {p.followOptions.map((o) => (
        <Button key={o.id} size='xs' variant='ghost' aria-label={`${p.name} follows ${o.name}`} disabled={o.bar !== null} title={o.bar ?? undefined} onClick={() => follow(p.id, o.id)}>follow {o.name}</Button>
      ))}
      {
        p.skirmish ?
        <span className='flex gap-1 items-center'>
          skirmish
          {
            p.stance ?
            <span className='text-fg'>{p.stance}{p.AP !== null ? <> · <span className='font-mono'>{p.AP}</span> AP</> : null}</span> :
            stances.map((stance) => (
              <Button key={stance} size='xs' aria-label={`${p.name} ${stance}`} disabled={p.stanceBar !== null} title={p.stanceBar ?? undefined} onClick={() => chooseStance(p.id, stance)}>{stance}</Button>
            ))
          }
        </span>
        : null
      }
      {p.joining ? <span>joining the fight of {p.joining.to} in <span className='font-mono text-fg'>{p.joining.rounds}</span> {p.joining.rounds === 1 ? 'round' : 'rounds'}</span> : null}
      {p.joinOptions.map((o) => (
        <Button key={o.id} size='xs' variant='ghost' aria-label={`${p.name} joins ${o.name}`} disabled={o.bar !== null} title={o.bar ?? undefined} onClick={() => join(p.id, o.id)}>join the fight of {o.name}</Button>
      ))}
    </div>
  )
}
