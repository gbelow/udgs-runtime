'use client'
import { useCombatActions } from '../hooks/useCombatActions'
import type { ActionOption, StrikeOption } from '../domain/combat/lenses/action'
import type { MovementOption } from '../domain/combat/lenses/move'
import type { OpenActionView } from '../domain/combat/lenses/actionPanel'
import type { HOPOption, Outcome } from '../domain/combat/lenses/damage'
import type { ActionCost } from '../domain/character/lenses/actionCosts'
import { Button, Panel, SectionLabel } from './ui'
import { SkillTooltip } from './SkillTooltip'

const STEP_LABEL = {
  declare: 'declare the attack',
  target: 'pick a target on the roster',
  react: 'the target answers',
  commit: 'commit',
  spend: 'spend the overflow',
  confirm: 'apply',
} as const

// The action being played out: what the active character can do while
// nothing is open, then one step at a time — the declaration, the target,
// the defender's answer and the die, the result — until it is resolved.
export function ActionPanel(){
  const { view, declare, amend, target, react, withdraw, cancel, roll, commit, spend, refund, resolve } = useCombatActions()
  const { step, open } = view

  if (!open) {
    return (
      <Panel title='Actions'>
        <div className='flex flex-row flex-wrap gap-1'>
          {view.options.map((o) => <OptionButton key={o.label} option={o} onClick={() => declare(o.draft)} />)}
          {view.options.length === 0 ? <span className='text-xs text-muted'>no character in the fight</span> : null}
        </div>
      </Panel>
    )
  }

  const rolled = step === 'spend' || step === 'confirm'
  const canCancel = !rolled
  return (
    <Panel title={<>{open.actor} · {open.label}{open.target ? <> → {open.target}</> : null}</>}
      meta={step ? STEP_LABEL[step] : null}
      pending={step === 'react'}
      actions={canCancel ? <Button size='xs' variant='ghost' aria-label='cancel action' onClick={cancel}>✕</Button> : null}>

      <Declaration open={open} strikes={view.strikes} onStrike={(s) => amend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant })} />

      {view.moves.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>movement</SectionLabel>
          {view.moves.map((m) => <MovementButton key={m.kind} option={m} active={m.kind === open.movement} onClick={() => amend({ movement: m.kind, path: [] })} />)}
        </div>
      ) : null}
      {view.moves.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-x-3 items-center text-xs text-muted'>
          <span>cells <span className='font-mono'>{open.path.length}</span> <Cost cost={open.cost} /></span>
          {open.path.length === 0 ? <span>pick a path on the board</span> : null}
          <Button variant='primary' aria-label='commit action' disabled={!view.canCommit} onClick={commit}>go</Button>
        </div>
      ) : null}

      {view.locations.length > 0 && !rolled ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>aim</SectionLabel>
          {view.locations.map((l) =>
            <Button key={l.location} size='xs' variant={l.location === open.location ? 'primary' : 'default'}
              className={l.location === open.location ? 'bg-accent/15' : ''}
              title={l.penalty ? `${-l.penalty} to hit` : 'no penalty'}
              onClick={() => amend({ location: l.location })}>
              {l.location}{l.penalty ? <span className='ml-1 font-mono text-bad'>−{l.penalty}</span> : null}
            </Button>)}
        </div>
      ) : null}

      {step === 'target' ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>target</SectionLabel>
          {view.targets.map((t) => <Button key={t.id} size='xs' onClick={() => target(t.id)}>{t.name}</Button>)}
          {view.targets.length === 0 ? <span className='text-xs text-muted'>nobody else in the fight</span> : null}
        </div>
      ) : null}

      {step === 'react' ? (
        <div className='flex flex-col gap-1'>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            <SectionLabel>{open.target} answers</SectionLabel>
            <Button size='xs' variant={open.reaction === null ? 'primary' : 'default'} className={open.reaction === null ? 'bg-accent/15' : ''} onClick={withdraw}>take it (SD)</Button>
            {view.options.map((o) =>
              <OptionButton key={o.label} option={o} active={o.chosen} onClick={() => react(o.draft)} />)}
          </div>
          <Test open={open} />
          <div><Button variant='primary' aria-label='roll action' disabled={!view.canRoll} onClick={roll}>roll</Button></div>
        </div>
      ) : null}

      {rolled ? (
        <div className='flex flex-col gap-1'>
          {open.roll ? <Test open={open} /> : null}
          {open.roll ? (
            <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-sm'>
              <span>die <span className='font-mono'>{open.roll.die}</span></span>
              <span>score <span className='font-mono'>{open.roll.score}</span> vs <span className='font-mono'>{open.roll.DL}</span></span>
              <span className={`font-medium ${open.roll.degree === 'miss' ? 'text-bad' : open.roll.degree === 'hit' ? 'text-good' : ''}`}>{open.roll.degree}</span>
              {open.roll.HOP ? <span>HOP <span className='font-mono'>{view.hop.remaining}</span><span className='text-muted'>/{open.roll.HOP}</span></span> : null}
            </div>
          ) : (
            <div className='text-xs text-muted'>{open.movement} · cells <span className='font-mono'>{open.path.length}</span> <Cost cost={open.cost} /></div>
          )}
          {step === 'spend' ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>overflow</SectionLabel>
              {view.hop.options.map((o) => <HOPButton key={o.purchase} option={o} onBuy={() => spend(o.purchase)} onRefund={() => refund(o.purchase)} />)}
            </div>
          ) : null}
          {view.outcome ? <OutcomeLine outcome={view.outcome} target={open.target ?? ''} /> : null}
          <div><Button variant='primary' aria-label='resolve action' onClick={resolve}>done</Button></div>
        </div>
      ) : null}
    </Panel>
  )
}

function Declaration({ open, strikes, onStrike }: { open: OpenActionView, strikes: StrikeOption[], onStrike: (s: StrikeOption) => void }){
  if (strikes.length > 0) {
    return (
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>attack</SectionLabel>
        {strikes.map((s) =>
          <Button key={`${s.weaponKey}:${s.attack}:${s.variant}`} size='xs'
            title={`blunt ${s.blunt} · cut ${s.cut}${s.penalty ? ` · ${-s.penalty} to hit` : ''}`}
            onClick={() => onStrike(s)}>
            {s.weapon} {s.attack} {s.variant} <Cost cost={{ AP: s.AP, STA: s.STA }} />
          </Button>)}
      </div>
    )
  }
  if (!open.attack) return null
  return (
    <div className='text-xs text-muted'>
      {open.attack} {open.variant} <Cost cost={open.cost} />
      {open.reaction ? <> · {open.reaction.label} <Cost cost={open.reaction.cost} /></> : null}
    </div>
  )
}

function Test({ open }: { open: OpenActionView }){
  return (
    <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-xs text-muted'>
      <SkillTooltip terms={open.score.terms} total={open.score.total}>
        <span>attack <span className='font-mono text-fg'>{open.score.total}</span></span>
      </SkillTooltip>
      <SkillTooltip terms={open.DL.terms} total={open.DL.total}>
        <span>vs DL <span className='font-mono text-fg'>{open.DL.total}</span></span>
      </SkillTooltip>
    </div>
  )
}

function MovementButton({ option, active, onClick }: { option: MovementOption, active: boolean, onClick: () => void }){
  return (
    <Button size='xs' variant={active ? 'primary' : 'default'} className={active ? 'bg-accent/15' : ''}
      disabled={!option.available} title={option.reason ?? `${option.speed} m per block`} onClick={onClick}>
      {option.kind} <Cost cost={option.block} />
    </Button>
  )
}

function OptionButton({ option, active = false, onClick }: { option: ActionOption, active?: boolean, onClick: () => void }){
  return (
    <Button size='xs' variant={active ? 'primary' : 'default'} className={active ? 'bg-accent/15' : ''}
      disabled={!option.available} title={option.reason ?? undefined} onClick={onClick}>
      {option.label} <Cost cost={option.cost} />
    </Button>
  )
}

// A purchase: click to buy, and once bought a second control to take it
// back — the die is thrown but nothing has landed yet.
function HOPButton({ option, onBuy, onRefund }: { option: HOPOption, onBuy: () => void, onRefund: () => void }){
  const bought = option.bought > 0
  return (
    <span className='inline-flex items-stretch'>
      <Button size='xs' variant={bought ? 'primary' : 'default'} className={bought ? 'bg-accent/15 rounded-r-none' : ''}
        disabled={!option.available} title={option.reason ?? undefined} onClick={onBuy}>
        {option.label} <span className='font-mono text-muted'>{option.cost}</span>
        {bought ? <span className='ml-1 font-mono'>×{option.bought}</span> : null}
      </Button>
      {bought ? <Button size='xs' variant='primary' className='bg-accent/15 rounded-l-none border-l-0' aria-label={`refund ${option.label}`} onClick={onRefund}>−</Button> : null}
    </span>
  )
}

// What the strike does to the target as it stands, one line.
function OutcomeLine({ outcome, target }: { outcome: Outcome, target: string }){
  if (outcome.stopped) return <div className='text-sm'>{target}: <span className='text-good'>intercepted</span></div>
  if (outcome.tier === null) {
    return <div className='text-sm'>{target}: <span className='font-mono'>{outcome.damage}</span> {outcome.type} vs <span className='font-mono'>{outcome.armor}</span> · <span className='text-muted'>no injury</span></div>
  }
  return (
    <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-sm'>
      <span>{target}: <span className='font-mono'>{outcome.damage}</span> {outcome.type} vs <span className='font-mono'>{outcome.armor}</span></span>
      <span className='font-medium text-bad'>T{outcome.tier}{outcome.bodyTier !== outcome.tier ? <span className='text-muted'> (body T{outcome.bodyTier})</span> : null}</span>
      <span>+<span className='font-mono'>{outcome.IL}</span> IL</span>
      {outcome.bleed ? <span>bleed +<span className='font-mono'>{outcome.bleed}</span></span> : null}
      {outcome.wound ? <span className='text-bad'>{outcome.wound.name}{outcome.wound.hand !== null ? ` (hand ${outcome.wound.hand + 1})` : ''}{outcome.wound.heal !== null ? ` · heals at ${outcome.wound.heal} IL` : ' · no heal'}</span> : null}
      {outcome.afflictions.map((a) => <span key={a} className='text-bad'>{a}</span>)}
      {outcome.interruption !== 'none' ? <span>{outcome.interruption}{outcome.apLoss ? <> −<span className='font-mono'>{outcome.apLoss}</span> AP</> : null}</span> : null}
      {outcome.dead ? <span className='font-medium text-bad'>dead</span> : null}
    </div>
  )
}

function Cost({ cost }: { cost: ActionCost | null }){
  if (!cost) return null
  return <span className='font-mono text-muted'>{cost.AP}AP{cost.STA ? ` ${cost.STA}STA` : ''}</span>
}
