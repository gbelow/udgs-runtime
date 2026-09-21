'use client'
import { useCombatActions } from '../hooks/useCombatActions'
import type { ActionOption, ReactorOptions, StrikeOption } from '../domain/combat/lenses/action'
import type { MovementOption } from '../domain/combat/lenses/move'
import type { OpenActionView } from '../domain/combat/lenses/actionPanel'
import type { HOPOption, Outcome } from '../domain/combat/lenses/damage'
import type { ActionCost } from '../domain/character/lenses/actionCosts'
import type { HitLocation } from '../domain/combat/types'
import { Button, Panel, SectionLabel } from './ui'
import { SkillTooltip } from './SkillTooltip'

const STEP_LABEL = {
  declare: 'declare',
  target: 'pick a target on the roster',
  commit: 'commit',
  react: 'reactions',
  spend: 'spend the overflow',
  confirm: 'apply',
} as const

// The action being played out: what the active character can do while
// nothing is open, then one step at a time — the declaration, the target,
// the actor's commitment, the reactions and the die, the result — until it
// is resolved.
export function ActionPanel(){
  const { view, declare, amend, target, react, amendReacted, withdraw, cancel, commit, back, skip, roll, pay, spend, refund, resolve } = useCombatActions()
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
  const locked = step === 'react' || rolled
  // before the commit the action is free to drop; one a reaction opened is
  // withdrawn along with the reaction instead
  const declared = !locked
  return (
    <Panel title={<>{open.actor} · {open.label}{open.target ? <> → {open.target}</> : null}</>}
      meta={step ? STEP_LABEL[step] : null}
      pending={step === 'react'}
      actions={declared && !open.spawned ? <Button size='xs' variant='ghost' aria-label='cancel action' onClick={cancel}>✕</Button> : null}>

      {declared && open.spawned ? (
        <div><Button size='xs' variant='ghost' aria-label='withdraw reaction' onClick={skip}>skip the {open.label}</Button></div>
      ) : null}

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
          {open.walked && open.walked.stop !== 'end' ? <span className='text-bad'>stops after {open.walked.cells} ({open.walked.stop})</span> : null}
          {open.path.length === 0 ? <span>pick a path on the board</span> : null}
        </div>
      ) : null}

      {view.locations.length > 0 && !locked ? (
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
          {view.noTargets ? <span className='text-xs text-muted'>{view.noTargets}</span> : null}
        </div>
      ) : null}

      {step === 'commit' ? (
        <div><Button variant='primary' aria-label='commit action' disabled={!view.canCommit} onClick={commit}>commit</Button></div>
      ) : null}

      {step === 'react' ? (
        <div className='flex flex-col gap-1'>
          {view.reactors.map((r) => {
            const answered = r.options.some((o) => o.chosen)
            if (r.strike) {
              return <ReactorStrike key={r.id} reactor={r} onAmend={(fields) => amendReacted(r.id, fields)} />
            }
            return (
              <div key={r.id} className='flex flex-row flex-wrap gap-1 items-center'>
                <SectionLabel>{r.name}</SectionLabel>
                <Button size='xs' variant={answered ? 'default' : 'primary'} className={answered ? '' : 'bg-accent/15'} onClick={() => withdraw(r.id)}>{r.id === open.targetId ? 'take it (SD)' : 'nothing'}</Button>
                {r.options.map((o) =>
                  <OptionButton key={o.label} option={o} active={o.chosen} onClick={() => react(r.id, o.draft)} />)}
              </div>
            )
          })}
          {view.reactors.length === 0 ? <span className='text-xs text-muted'>nobody reacts</span> : null}
          {view.jumpPending ? <span className='text-xs text-muted'>pick where the evasive jump lands on the board</span> : null}
          {view.die ? <Test open={open} /> : null}
          <div className='flex flex-row gap-1'>
            {view.die
              ? <Button variant='primary' aria-label='roll action' disabled={!view.canRoll} onClick={roll}>roll</Button>
              : <Button variant='primary' aria-label='pay action' disabled={!view.canPay} onClick={pay}>go</Button>}
            <Button variant='ghost' aria-label='back' disabled={!view.canBack} title='take back the last reaction' onClick={back}>back</Button>
          </div>
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
          ) : null}
          {open.walked ? (
            <div className='text-xs text-muted'>{open.movement} · walks <span className='font-mono'>{open.walked.cells}</span> of <span className='font-mono'>{open.path.length}</span>{open.walked.stop !== 'end' ? <span className='text-bad'> · {open.walked.stop}</span> : null} <Cost cost={open.cost} /></div>
          ) : null}
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
      {open.spawned ? <span className='text-bad'>opportunity · </span> : null}
      {open.attack} {open.variant} <Cost cost={open.cost} />
      {open.reactions.map((r) => <span key={`${r.actor}:${r.label}`}> · {r.actor} {r.label} <Cost cost={r.cost} /></span>)}
    </div>
  )
}

// A reactor who has chosen an opportunity attack declares the strike it
// opens here — the row and where it aims. The panel's back takes the choice
// itself back.
function ReactorStrike({ reactor, onAmend }: { reactor: ReactorOptions, onAmend: (fields: { weaponKey?: string; attack?: string; variant?: string; location?: HitLocation }) => void }){
  const strike = reactor.strike!
  const chosen = reactor.options.find((o) => o.chosen)
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>{reactor.name}</SectionLabel>
        <span className='text-xs'>{chosen?.label ?? 'opportunity attack'}</span>
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>attack</SectionLabel>
        {strike.options.map((s) => {
          const active = s.attack === strike.attack && s.variant === strike.variant
          return (
            <Button key={`${s.weaponKey}:${s.attack}:${s.variant}`} size='xs' variant={active ? 'primary' : 'default'} className={active ? 'bg-accent/15' : ''}
              title={`blunt ${s.blunt} · cut ${s.cut}${s.penalty ? ` · ${-s.penalty} to hit` : ''}`}
              onClick={() => onAmend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant })}>
              {s.weapon} {s.attack} {s.variant} <Cost cost={{ AP: s.AP, STA: s.STA }} />
            </Button>
          )
        })}
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>aim</SectionLabel>
        {strike.locations.map((l) =>
          <Button key={l.location} size='xs' variant={l.location === strike.location ? 'primary' : 'default'}
            className={l.location === strike.location ? 'bg-accent/15' : ''}
            title={l.penalty ? `${-l.penalty} to hit` : 'no penalty'}
            onClick={() => onAmend({ location: l.location })}>
            {l.location}{l.penalty ? <span className='ml-1 font-mono text-bad'>−{l.penalty}</span> : null}
          </Button>)}
      </div>
      {!strike.complete ? <span className='text-xs text-muted'>{strike.attack ? 'that attack cannot reach from there' : 'pick the attack'}</span> : null}
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
