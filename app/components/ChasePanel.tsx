'use client'
import { useState } from 'react'
import { Button, SectionLabel, selectClass } from './ui'
import { useChase, useChaseCommands } from '../hooks/useChase'
import type { ChaseCover, ChaseTier } from '../domain/lists'

// combat.tex "Chases": who runs away and from how far, the round's run, and
// which way its winner takes the distance.
export function ChasePanel(){
  const [quarry, setQuarry] = useState<string[]>([])
  const [startTier, setStartTier] = useState<ChaseTier>('combat')
  const chase = useChase(quarry, startTier)
  const { startChase, run, choose, endChase, turnAround, chooseStance, setCover } = useChaseCommands()
  if (chase.parties.length < 2 && !chase.chasing) return null

  const toggle = (id: string) => setQuarry(quarry.includes(id) ? quarry.filter((q) => q !== id) : [...quarry, id])

  return(
    <div className='flex flex-col gap-1 py-2 border-b border-line text-sm'>
      <div className='flex flex-row flex-wrap gap-3 items-center'>
        <SectionLabel>Chase</SectionLabel>
        <span className='text-xs text-muted'>time <span className='font-mono text-fg'>{chase.elapsed}</span></span>
        {chase.chasing ? <span className='text-xs text-muted'>a round takes <span className='font-mono text-fg'>{chase.roundTakes}</span></span> : null}
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
        </div>
        :
        <>
          <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs'>
            <span className='text-muted'>running away: <span className='text-fg'>{chase.parties.filter((p) => p.quarry).map((p) => p.name).join(', ')}</span></span>
            <span className='flex gap-1'>
              {chase.tiers.map((t) => <span key={t} className={`px-1.5 rounded border ${t === chase.tier ? 'border-accent text-accent' : 'border-line text-muted'}`}>{t}</span>)}
            </span>
            <Button size='xs' aria-label='runChase' disabled={chase.runBar !== null} title={chase.runBar ?? undefined} onClick={run}>run</Button>
            {chase.ways.map((way) => (
              <Button key={way} size='xs' aria-label={`${way} the distance`} onClick={() => choose(way)}>{way === 'close' ? 'close in' : 'pull away'}</Button>
            ))}
            <Button size='xs' aria-label='endChase' onClick={endChase}>end chase</Button>
          </div>
          {
            !chase.escaped ?
            <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
              <span>turn around</span>
              {chase.quarry.map((q) => (
                <label key={q.id} className='flex gap-1 items-center'>
                  <input type='checkbox' aria-label={`turn around ${q.name}`} checked={q.turned} onChange={() => turnAround(q.id)} />
                  {q.name}
                </label>
              ))}
            </div>
            : <span className='text-xs text-good'>the quarry got away</span>
          }
          {
            chase.skirmish.length > 0 ?
            <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center text-xs text-muted'>
              <span>skirmish</span>
              {chase.skirmish.map((s) => (
                <span key={s.side} className='flex gap-1 items-center'>
                  {s.side}
                  {
                    s.stance ?
                    <span className='text-fg'>{s.stance}{s.AP !== null ? <> · <span className='font-mono'>{s.AP}</span> AP</> : null}</span> :
                    chase.stances.map((stance) => (
                      <Button key={stance} size='xs' aria-label={`${s.side} ${stance}`} disabled={s.bar !== null} title={s.bar ?? undefined} onClick={() => chooseStance(s.side, stance)}>{stance}</Button>
                    ))
                  }
                </span>
              ))}
            </div>
            : null
          }
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
          {chase.caught.map((reason) => <span key={reason} className='text-xs text-bad'>caught: {reason}</span>)}
          {
            chase.run ?
            <div className='flex flex-col gap-0.5 text-xs text-muted'>
              <span>
                run at {chase.run.tier}: quarry <span className='font-mono text-fg'>{chase.run.quarry}</span>, pursuers <span className='font-mono text-fg'>{chase.run.pursuers}</span>
                {' — '}{chase.run.winner === 'draw' ? 'a draw' : `${chase.run.winner} win`}
                {chase.run.coin !== null ? <> (draw settled by <span className='font-mono'>{chase.run.coin}</span>)</> : null}
              </span>
              <span className='flex flex-row flex-wrap gap-x-3'>
                {chase.run.runners.map((r) => (
                  <span key={r.id} className={r.slowest ? 'text-fg' : undefined}>{r.name} ({r.side}) <span className='font-mono'>{r.speed}</span></span>
                ))}
              </span>
            </div>
            : null
          }
        </>
      }
    </div>
  )
}
