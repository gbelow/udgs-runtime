'use client'
import { useCombatActions } from '../hooks/useCombatActions'
import type { ActionOption, StrikeOption } from '../domain/combat/lenses/action'
import type { OpenActionView } from '../domain/combat/lenses/actionPanel'
import type { HOPOption, Outcome } from '../domain/combat/lenses/damage'
import type { ActionCost } from '../domain/character/lenses/actionCosts'
import { Button, Panel, SectionLabel } from './ui'
import { SkillTooltip } from './SkillTooltip'

const STEP_LABEL = {
  declare: 'declare the attack',
  target: 'pick a target on the roster',
  react: 'the target answers',
  spend: 'spend the overflow',
  confirm: 'apply',
} as const

// The action being played out: what the active character can do while
// nothing is open, then one step at a time — the declaration, the target,
// the defender's answer and the die, the result — until it is resolved.
export function ActionPanel(){
  const { view, declare, amend, target, react, withdraw, cancel, roll, spend, resolve } = useCombatActions()
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

      {view.locations.length > 0 && !rolled ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>aim</SectionLabel>
          {view.locations.map((l) =>
            <Button key={l.location} size='xs' active={l.location === open.location}
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
            <Button size='xs' active={open.reaction === null} onClick={withdraw}>take it (SD)</Button>
            {view.options.map((o) =>
              <OptionButton key={o.label} option={o} active={open.reaction?.label === o.label} onClick={() => react(o.draft)} />)}
          </div>
          <Test open={open} />
          <div><Button variant='primary' aria-label='roll action' disabled={!view.canRoll} onClick={roll}>roll</Button></div>
        </div>
      ) : null}

      {rolled && open.roll ? (
        <div className='flex flex-col gap-1'>
          <Test open={open} />
          <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-sm'>
            <span>die <span className='font-mono'>{open.roll.die}</span></span>
            <span>score <span className='font-mono'>{open.roll.score}</span> vs <span className='font-mono'>{open.roll.DL}</span></span>
            <span className={`font-medium ${open.roll.degree === 'miss' ? 'text-bad' : open.roll.degree === 'hit' ? 'text-good' : ''}`}>{open.roll.degree}</span>
            {open.roll.HOP ? <span>HOP <span className='font-mono'>{view.hop.remaining}</span><span className='text-muted'>/{open.roll.HOP}</span></span> : null}
          </div>
          {step === 'spend' ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>overflow</SectionLabel>
              {view.hop.options.map((o) => <HOPButton key={o.purchase} option={o} onClick={() => spend(o.purchase)} />)}
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

function OptionButton({ option, active = false, onClick }: { option: ActionOption, active?: boolean, onClick: () => void }){
  return (
    <Button size='xs' active={active} disabled={!option.available} title={option.reason ?? undefined} onClick={onClick}>
      {option.label} <Cost cost={option.cost} />
    </Button>
  )
}

function HOPButton({ option, onClick }: { option: HOPOption, onClick: () => void }){
  return (
    <Button size='xs' disabled={!option.available} title={option.reason ?? undefined} onClick={onClick}>
      {option.label} <span className='font-mono text-muted'>{option.cost}</span>
      {option.bought ? <span className='ml-1 font-mono text-good'>×{option.bought}</span> : null}
    </Button>
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
      {outcome.wound ? <span className='text-bad'>{outcome.wound.name}{outcome.wound.heal !== null ? ` (${outcome.wound.heal} IL)` : ''}</span> : null}
      {outcome.afflictions.map((a) => <span key={a} className='text-bad'>{a}</span>)}
      {outcome.interruption !== 'none' ? <span>{outcome.interruption} −<span className='font-mono'>{outcome.apLoss}</span> AP</span> : null}
      {outcome.dead ? <span className='font-medium text-bad'>dead</span> : null}
    </div>
  )
}

function Cost({ cost }: { cost: ActionCost | null }){
  if (!cost) return null
  return <span className='font-mono text-muted'>{cost.AP}AP{cost.STA ? ` ${cost.STA}STA` : ''}</span>
}
