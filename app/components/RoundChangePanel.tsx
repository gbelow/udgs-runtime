'use client'
import { useState } from 'react'
import { Card } from './SceneCards'
import { ChaseSetup } from './ChasePanel'
import { Check, ChevronRight } from 'lucide-react'
import { ActionKey, NumberInput, Panel, SectionLabel, Tooltip } from './ui'
import { useCombatState, useMorale, useRoundChange, useTablePressure } from '../hooks/useCombatState'
import { GmLocked } from './Locks'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { ROLL_MODES } from '../domain/play/dice'
import { RollButtons } from './DieCalls'
import type { RoundCard, RoundChangeView, RoundStepView } from '../domain/scene/projections/roundChange'

const HINTS: Partial<Record<RoundChangeView['phase'], string>> = {
  rest: 'pick a character to rest or speak from the bar below, with what is left of both rounds',
  concentration: 'whoever keeps something going pays for it again, or lets it go and finishes what they held',
  join: 'characters can join the fight now, from the Character panel or the Party tab',
  stress: 'the limit stress actions are taken as turns, the worst test first',
}

const STEP_LOOK: Record<RoundStepView['status'], string> = {
  done: 'border-line text-muted',
  current: 'border-accent bg-accent/15 text-accent font-semibold ring-2 ring-accent/30',
  next: 'border-dashed border-line text-muted',
}

const STEP_DOT: Record<RoundStepView['status'], string> = {
  done: 'bg-raised text-muted',
  current: 'bg-accent text-bg',
  next: 'border border-line',
}

// What pressing on takes away from someone, so that nobody misses a chance by
// it; `inline` keeps it to one line for the strip.
export function Forfeits({ lines, inline = false }: { lines: string[], inline?: boolean }){
  return (
    <div className={`flex text-xs border-l-2 border-bad pl-2 ${inline ? 'flex-row flex-wrap gap-x-2' : 'flex-col gap-0.5'}`}>
      <span className='font-semibold text-bad'>after this, no longer possible:</span>
      {lines.map((line, i) => <span key={i} className='text-fg'>{line}</span>)}
    </div>
  )
}

// The round change in the middle of the run screen: its steps, where it
// stands, and each character with what it did to them and what they still
// choose in it.
export function RoundChangePanel(){
  const { view, pick } = useRoundChange()
  const { round } = useCombatState()
  const { continueRound } = useCombatCommands()
  if (!view) return null

  return (
    <Panel title={`Round ${round} begins`} meta={view.steps.find((s) => s.status === 'current')?.label}>
      <div className='flex flex-col gap-3'>
        <ol aria-label='round change steps' className='flex flex-row flex-wrap items-center gap-y-2'>
          {view.steps.map((s, i) => (
            <li key={s.phase} className='flex items-center'>
              {i > 0 ? <span aria-hidden className={`h-px w-5 mx-1 ${s.status === 'next' ? 'bg-line' : 'bg-accent'}`} /> : null}
              <span aria-current={s.status === 'current' ? 'step' : undefined} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${STEP_LOOK[s.status]}`}>
                <span className={`inline-flex size-4 items-center justify-center rounded-full font-mono text-[10px] ${STEP_DOT[s.status]}`}>
                  {s.status === 'done' ? <Check size={10} aria-hidden /> : i + 1}
                </span>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
        <div className={`flex flex-row flex-wrap items-center gap-3 rounded border p-2 ${view.closing.length > 0 ? 'border-bad/60 bg-bad/5' : 'border-line bg-raised/40'}`}>
          <div className='flex-1 min-w-48'>
            {view.closing.length > 0 ? <Forfeits lines={view.closing} /> : <span className='text-xs text-muted'>nobody loses a chance by moving on</span>}
          </div>
          <Tooltip text={view.continueBar}>
            <ActionKey look={view.closing.length > 0 ? 'warn' : 'go'} icon={ChevronRight} aria-label='continueRound' disabled={view.continueBar !== null} onClick={continueRound}>{view.continueLabel}</ActionKey>
          </Tooltip>
        </div>
        {HINTS[view.phase] ? <span className='text-xs text-muted'>{HINTS[view.phase]}</span> : null}
        {view.phase === 'morale' ? <MoralePanel /> : null}
        {view.phase === 'chase' ? <ChaseSetup /> : null}
        {view.parties.map((party) => (
          <div key={party.id} className='flex flex-col gap-1.5'>
            {party.name ? <span className='text-[10px] uppercase tracking-wide text-muted'>{party.name}</span> : null}
            <div className='flex flex-row flex-wrap gap-2'>
              {party.cards.map((card) => <Card key={card.id} card={card} onClick={() => pick(card)}><RoundLines card={card} /></Card>)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function RoundLines({ card }: { card: RoundCard }){
  const { holdOn, letGo } = useCombatCommands()
  const held = card.concentration
  if (card.happened.length === 0 && !held && !card.morale && !card.stress) return null

  return (
    <>
      {card.happened.map((line, i) => <span key={i} className='text-muted'>{line}</span>)}
      {held ? (
        <div className='flex flex-col gap-1 border-t border-line pt-1'>
          {held.holds.length > 0 ? <span className='text-muted'>keeps <span className='text-fg'>{held.holds.join(', ')}</span></span> : null}
          {held.chose ? <span className='text-accent'>{held.chose}</span> : (
            <div className='flex flex-row gap-1'>
              <Tooltip text={held.holdBar}>
                <ActionKey aria-label={`hold on ${card.name}`} disabled={held.holdBar !== null} onClick={() => holdOn(card.id)}>hold on{held.focus ? ' (focus surge)' : ''}</ActionKey>
              </Tooltip>
              <Tooltip text={held.letGoBar}>
                <ActionKey aria-label={`let go ${card.name}`} disabled={held.letGoBar !== null} onClick={() => letGo(card.id)}>let go</ActionKey>
              </Tooltip>
            </div>
          )}
        </div>
      ) : null}
      {card.morale ? <span className={card.morale.result ? 'text-muted' : 'text-bad'}>morale {card.morale.result || `DL ${card.morale.DL}: to test`}</span> : null}
      {card.stress ? <span className='text-bad'>{card.stress}</span> : null}
    </>
  )
}

// combat.tex "Morale": the round begins with a will test for whoever the fight
// has under stress, made normally, safely or riskily; a miss activates the
// limit stress action, which the table plays out. Whether an enemy is within
// 30 m is the table's to say, and so is the pressure the fight puts on each
// fighter.
function MoralePanel(){
  const rows = useMorale()
  const pressure = useTablePressure()
  const { rollMorale, setTablePressure } = useCombatCommands()
  const [enemyNear, setEnemyNear] = useState(true)
  if (pressure.length === 0) return null

  return(
    <div className='flex flex-col gap-1 py-2 border-y border-line text-sm'>
      <GmLocked>
        <div className='flex flex-row gap-3 items-center'>
          <SectionLabel>Morale</SectionLabel>
          <label className='flex gap-1 items-center text-xs text-muted'>
            <input type='checkbox' aria-label='enemyNear' checked={enemyNear} onChange={(e) => setEnemyNear(e.target.checked)} />
            enemy within 30 m
          </label>
        </div>
        <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
          <span>pressure</span>
          {pressure.map((r) => (
            <label key={r.id} className='flex gap-1 items-center'>
              {r.name}
              <NumberInput className='w-10' aria-label={`pressure ${r.name}`} value={r.value} onChange={(e) => setTablePressure(r.id, parseInt(e.target.value) || 0)} />
            </label>
          ))}
        </div>
      </GmLocked>
      {rows.length === 0 ? <span className='text-xs text-muted'>nobody is called to a test</span> : null}
      {rows.map((r) => (
        <div key={r.id} className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
          <span className='font-medium'>{r.name}</span>
          <span className='text-muted'>DL <span className='font-mono text-fg'>{r.DL}</span>{r.aggravators ? ` (${r.aggravators})` : ''}</span>
          {
            !r.result ?
            <RollButtons name={r.name} options={ROLL_MODES.map((mode) => ({ key: mode, label: `morale ${mode}` }))} onRoll={(mode, die) => rollMorale(r.id, mode, enemyNear, die)} /> :
            <span className='text-xs text-muted'>{r.result}</span>
          }
          {r.limitStress ? <span className='text-xs text-bad border border-bad rounded px-1.5'>limit stress action: {r.limitStress}</span> : null}
          {r.owed ? <span className='text-xs text-muted'>{r.owed}</span> : null}
        </div>
      ))}
    </div>
  )
}
