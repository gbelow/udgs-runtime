'use client'
import { useCombatActions } from '../hooks/useCombatActions'
import type { CastGearOption, ImprovementOption } from '../domain/scene/rules/cast'
import type { MovementOption } from '../domain/scene/rules/move'
import type { ActionOptionView, AttackOptionView, HOPOptionView, OpenActionView, PushView, ReactorOptions, SpellOptionView } from '../domain/scene/projections/actionPanel'
import type { EpisodeEntry } from '../domain/scene/projections/episode'
import type { Outcome } from '../domain/character/rules/damage'
import type { ActionCost } from '../domain/character/rules/actionCosts'
import type { Action, ActionDraft, ActionRoll, CostTerm, StrikeAction } from '../domain/scene/types'
import { Button, Panel, SectionLabel, Tooltip } from './ui'
import type { Term } from '../domain/character/lenses'
import { Preparation } from './Preparation'
import { StrikeModifiers } from './StrikeModifiers'

// A button's look while it is the one picked.

const STEP_LABEL = {
  declare: 'declare',
  target: 'pick a target',
  aim: 'aim on the board',
  commit: 'commit',
  react: 'reactions',
  spend: 'spend the overflow',
  choose: 'choose what the hit takes',
  confirm: 'apply',
} as const

// The action being played out: what the active character can do while
// nothing is open, then one step at a time — the declaration, the target,
// the actor's commitment, the reactions and the die, the result — until it
// is resolved.
export function ActionPanel(){
  const { view, declare, amend, target, react, amendReacted, withdraw, cancel, commit, back, skip, roll, pay, accept, spend, refund, grapple, resolve, improve, unimprove, grazeSave, restMove, extend, cast, choose, boostPush } = useCombatActions()
  const { step, open } = view

  if (!open) {
    return (
      <Panel title='Actions'>
        <div className='flex flex-row flex-wrap gap-1'>
          {view.options.map((o) => <OptionButton key={o.label} option={o} onClick={() => declare(o.draft)} />)}
          {view.options.length === 0 ? <span className='text-xs text-muted'>no character in the fight</span> : null}
        </div>
        {view.social.length > 0 ? (
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            <SectionLabel>social</SectionLabel>
            {view.social.map((o) => <OptionButton key={o.label} option={o} onClick={() => declare(o.draft)} />)}
          </div>
        ) : null}
        <Prepared rows={view.prepared} />
      </Panel>
    )
  }

  const rolled = step === 'spend' || step === 'choose' || step === 'confirm'
  const locked = step === 'react' || rolled
  // before the commit the action is free to drop; one a reaction opened is
  // withdrawn along with the reaction instead
  const declared = !locked
  return (
    <Panel title={<>{open.actor} · {open.label}{open.target ? <> → {open.target}</> : null}</>}
      meta={step ? STEP_LABEL[step] : null}
      pending={step === 'react'}
      actions={declared && !open.spawned ? <Button size='xs' variant='ghost' aria-label='cancel action' onClick={cancel}>✕</Button> : null}>

      {declared && open.required ? <span className='text-xs text-muted'>prepared: it must be done</span> : null}

      {view.prepare ? <Preparation view={view.prepare} onAmend={amend} onSpell={cast} onExtend={extend} /> : null}

      {open.flee !== null ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <Button size='xs' selected={open.flee} onClick={() => amend({ flee: true })}>flee</Button>
          <Button size='xs' selected={!open.flee} onClick={() => amend({ flee: false })}>end</Button>
        </div>
      ) : null}

      <Declaration open={open} attacks={view.attacks}
        onAttack={(s) => amend(s.selected ? { weaponKey: '', attack: '', variant: '' } : { weaponKey: s.weaponKey, attack: s.attack, variant: s.variant })} />

      {open.sweep ? (
        <div className='flex flex-row flex-wrap gap-1 items-center text-xs'>
          <SectionLabel>sweep</SectionLabel>
          {open.sweep.turnable
            ? <SweepDirections direction={open.sweep.direction} onTurn={(sweepDirection) => amend({ sweepDirection })} />
            : <span className='text-muted'>{open.sweep.direction}</span>}
          {open.sweep.next.length > 0 ? <span className='text-muted'>then {open.sweep.next.join(' → ')}</span> : null}
          {open.sweep.left !== null ? <span className='font-mono text-bad'>{open.sweep.left}% of the blow left</span> : null}
        </div>
      ) : null}

      <StrikeModifiers modifiers={open.modifiers} onPress={amend} />

      {view.ammo.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>ammo</SectionLabel>
          {view.ammo.map((a) =>
            <Button key={a.itemId} size='xs' selected={a.itemId === open.ammoId}
              title={a.properties.join(', ')} onClick={() => amend({ ammoId: a.itemId })}>
              {a.name} <span className='font-mono text-muted'>×{a.amount}</span>
            </Button>)}
        </div>
      ) : null}

      {open.floor.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>floor</SectionLabel>
          {open.floor.map((f) =>
            <Button key={f.itemId} size='xs' selected={f.itemId === open.item}
              disabled={!f.available} title={f.available ? undefined : 'no free hand'} onClick={() => amend({ itemId: f.itemId })}>
              {f.name}
            </Button>)}
        </div>
      ) : null}

      {open.potions.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>potion</SectionLabel>
          {open.potions.map((p) =>
            <Button key={p.itemId} size='xs' selected={p.itemId === open.item}
              onClick={() => amend({ itemId: p.itemId })}>
              {p.name}
            </Button>)}
        </div>
      ) : null}

      {open.push ? <Push push={open.push} cost={open.cost} onMovement={(movement) => amend({ movement, path: [] })} onBoost={boostPush} /> : null}

      {view.spells.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>spell</SectionLabel>
          {view.spells.map((s) => <SpellButton key={s.key} option={s} onCast={() => cast(s.key, false)} onQuicken={() => cast(s.key, true)} />)}
        </div>
      ) : null}
      <GearPicker label='with' options={view.gear} selected={open.castItemId} onPick={(itemId) => amend({ itemId })} />
      <GearPicker label='charge into' options={view.chargeInto} selected={open.chargeItemId} onPick={(chargeItemId) => amend({ chargeItemId })} />
      {open.suggestion && !locked ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>suggest</SectionLabel>
          {open.suggestion.options.length === 0 ? <span className='text-xs text-muted'>pick a target who is afraid, enraged or confused</span> : null}
          {open.suggestion.options.map((a) =>
            <Button key={a} size='xs' selected={a === open.suggestion?.picked}
              onClick={() => amend({ suggested: a })}>
              {a}
            </Button>)}
        </div>
      ) : null}
      {open.spell && !locked ? <div className='text-xs text-muted'>{open.spell}{open.quicken ? ' · quickened' : ''} <Cost cost={open.cost} /></div> : null}
      {open.spell && open.extend && !locked ? (
        <div className='flex flex-row gap-1 items-center text-xs'>
          <SectionLabel>extend</SectionLabel>
          <Button size='xs' aria-label='extend less' disabled={open.extend.times === 0} onClick={() => extend(-1)}>−</Button>
          <span className='font-mono'>×{open.extend.times}</span>
          <Button size='xs' aria-label='extend more' onClick={() => extend(1)}>+</Button>
          {open.extend.times > 0 ? <span className='text-muted'>+{open.extend.DL} DL</span> : null}
        </div>
      ) : null}

      {view.charges.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>charge</SectionLabel>
          {view.charges.map((c) => (
            <Button key={c.itemId} size='xs' selected={c.itemId === open.itemId}
              onClick={() => amend({ itemId: c.itemId, key: c.key, center: c.cell })}>
              {c.name} <span className='text-muted'>in {c.item} · {c.holder}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {open.source && open.source !== 'thrown' ? <div className='text-xs text-muted'>{open.source === 'cast' ? 'from the spell' : 'set off — no test'}</div> : null}

      {open.openedBy ? (
        <RollLine roll={open.openedBy.roll} label={open.openedBy.label} className='text-xs text-muted'>
          {open.openedBy.budget !== null ? <span>up to <span className='font-mono'>{open.openedBy.budget}</span> AP</span> : null}
        </RollLine>
      ) : null}

      {view.moves.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>movement</SectionLabel>
          {view.moves.map((m) => <MovementButton key={m.kind} option={m} active={m.kind === open.movement} onClick={() => amend({ movement: m.kind, path: [], dive: 0, mode: 'normal', leap: false, metres: null })} />)}
        </div>
      ) : null}
      {open.climbModes.length > 1 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>climb</SectionLabel>
          {open.climbModes.map((mode) => <Button key={mode} size='xs' selected={mode === open.mode} onClick={() => amend({ mode })}>{mode}</Button>)}
        </div>
      ) : null}
      {open.climbSteps ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>metres</SectionLabel>
          <Button size='xs' aria-label='climb less' disabled={open.climbSteps.metres <= 1} onClick={() => amend({ metres: open.climbSteps ? open.climbSteps.metres - 1 : null })}>−</Button>
          <span className='font-mono text-xs'>{open.climbSteps.metres} / {open.climbSteps.remaining}</span>
          <Button size='xs' aria-label='climb more' disabled={open.climbSteps.metres >= open.climbSteps.remaining} onClick={() => amend({ metres: open.climbSteps ? open.climbSteps.metres + 1 : null })}>+</Button>
        </div>
      ) : null}
      {open.canLeap ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>start</SectionLabel>
          <Button size='xs' selected={open.leap} onClick={() => amend({ leap: !open.leap })}>jump</Button>
        </div>
      ) : null}
      {open.diveSteps ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>dive</SectionLabel>
          <Button size='xs' aria-label='swim up' disabled={open.diveSteps.up === null} onClick={() => open.diveSteps?.up !== null && amend({ dive: open.diveSteps?.up })}>up</Button>
          <span className='font-mono text-xs'>{open.dive}</span>
          <Button size='xs' aria-label='swim down' disabled={open.diveSteps.down === null} onClick={() => open.diveSteps?.down !== null && amend({ dive: open.diveSteps?.down })}>down</Button>
        </div>
      ) : null}
      {view.moves.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-x-3 items-center text-xs text-muted'>
          <span>cells <span className='font-mono'>{open.path.length}</span> <Cost cost={open.cost} /></span>
          {open.walked && open.walked.stop !== 'end' ? <span className='text-bad'>stops after {open.walked.cells} ({open.walked.stop})</span> : null}
          {open.path.length === 0 && open.dive === 0 && open.movement !== 'stand' && open.movement !== 'prone' ? <span>pick a path on the board</span> : null}
        </div>
      ) : null}

      {view.targets.length > 0 || view.hidden.length > 0 || view.noTargets ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>target</SectionLabel>
          {view.targets.map((t) =>
            <Button key={t.id} size='xs' selected={t.selected} onClick={() => target(t.id)}>{t.name}</Button>)}
          {view.hidden.map((t) =>
            <Button key={t.id} size='xs' disabled title='not detected'>{t.name}</Button>)}
          {view.noTargets ? <span className='text-xs text-muted'>{view.noTargets}</span> : null}
        </div>
      ) : null}

      {view.locations.length > 0 && !locked ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>aim</SectionLabel>
          {view.locations.map((l) =>
            <Button key={l.part ?? l.location} size='xs' selected={l.selected}
              title={l.penalty ? `${-l.penalty} to hit` : 'no penalty'}
              onClick={() => amend({ location: l.location, part: l.part, object: '' })}>
              {l.name}{l.penalty ? <span className='ml-1 font-mono text-bad'>−{l.penalty}</span> : null}
            </Button>)}
          {view.items.map((i) =>
            <Button key={i.id} size='xs' selected={i.selected}
              title={`break their ${i.name}: ${-i.penalty} to hit`}
              onClick={() => amend({ object: i.id })}>
              {i.name}<span className='ml-1 font-mono text-bad'>−{i.penalty}</span>
            </Button>)}
        </div>
      ) : null}

      {open.area?.aimable ? (
        <div className='text-xs text-muted'>{open.area.shape === 'spray' ? 'click a cell on the board to point the spray' : 'click the cell on the board where it lands'}{open.area.aimed ? ' — or elsewhere to move it' : ''}</div>
      ) : null}

      {declared && open.score.terms.length > 0 ? <Test open={open} /> : null}

      {declared ? (
        <div className='flex flex-row flex-wrap gap-1'>
          <Button variant='primary' aria-label='commit action' disabled={!view.canCommit} title={view.holds ? 'not enough AP: it is held over to the next round' : step && !view.canCommit ? STEP_LABEL[step] : undefined} onClick={commit}>{view.holds ? 'hold' : 'commit'}</Button>
          {open.spawned && open.flee === null && !open.required ? (
            <Button aria-label='withdraw reaction' onClick={skip}>{open.label === 'move' ? 'stay put' : `skip the ${open.label}`}</Button>
          ) : null}
        </div>
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
                <Button size='xs' selected={!answered} onClick={() => withdraw(r.id)}>{r.id === open.targetId ? 'take it (SD)' : 'nothing'}</Button>
                {r.options.map((o) =>
                  <OptionButton key={o.label} option={o} active={o.chosen} onClick={() => react(r.id, o.draft)} />)}
                {r.cancellable ? <span className='text-xs text-bad'>defending actively gives up the {r.cancellable}</span> : null}
              </div>
            )
          })}
          {view.reactors.length === 0 ? <span className='text-xs text-muted'>nobody reacts</span> : null}
          {view.unnoticed.length > 0 ? <span className='text-xs text-muted'>did not notice: {view.unnoticed.join(', ')}</span> : null}
          {view.jumpPending ? <span className='text-xs text-muted'>pick where the evasive jump lands on the board</span> : null}
          {view.stepPending ? <span className='text-xs text-muted'>pick where {view.stepPending} steps on the board</span> : null}
          {view.die || view.compare || open.area ? <Test open={open} /> : null}
          <div className='flex flex-row gap-1'>
            {view.die
              ? <Button variant='primary' aria-label='roll action' disabled={!view.canRoll} onClick={roll}>roll</Button>
              : <Button variant='primary' aria-label='pay action' disabled={!view.canPay} onClick={pay}>go</Button>}
            {view.canAccept ? <Button variant='default' aria-label='accept spell' title='the target allows it: no test' onClick={accept}>allow it</Button> : null}
            <Button variant='ghost' aria-label='back' disabled={!view.canBack} title='take back the last reaction' onClick={back}>back</Button>
          </div>
        </div>
      ) : null}

      {rolled ? (
        <div className='flex flex-col gap-1'>
          {open.roll || view.compare ? <Test open={open} /> : null}
          {open.roll ? (
            <RollLine roll={open.roll} className='text-sm'>
              {open.roll.HOP || view.hop.options.length > 0 ? <span>HOP <span className='font-mono'>{view.hop.remaining}</span><span className='text-muted'>/{open.roll.HOP}</span></span> : null}
            </RollLine>
          ) : null}
          {open.walked ? (
            <div className='text-xs text-muted'>{open.movement} · walks <span className='font-mono'>{open.walked.cells}</span> of <span className='font-mono'>{open.path.length}</span>{open.walked.stop !== 'end' ? <span className='text-bad'> · {open.walked.stop}</span> : null} <Cost cost={open.cost} /></div>
          ) : null}
          {step === 'spend' && view.hop.options.length > 0 ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>overflow</SectionLabel>
              {view.hop.options.map((o) => <HOPButton key={o.purchase} option={o} onBuy={() => spend(o.purchase)} onRefund={() => refund(o.purchase)} />)}
            </div>
          ) : null}
          {step === 'spend' && open.grapples !== null ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>on the hit</SectionLabel>
              <Button size='xs' selected={open.grapples} title='the target is grappled, for nothing' onClick={() => grapple(!open.grapples)}>grapple</Button>
            </div>
          ) : null}
          {step === 'spend' && view.castHOP.options.length > 0 ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>HOP <span className='font-mono'>{view.castHOP.remaining}</span></SectionLabel>
              {view.castHOP.options.map((o) => <ImprovementButton key={o.name} option={o} onBuy={() => improve(o.name)} onRefund={() => unimprove(o.name)} />)}
            </div>
          ) : null}
          {view.deliveries.map((d, i) => (
            <div key={i} className='text-sm'>{d.target}: {d.name || d.kind} {d.test ? <span className='text-muted'>· rolls {d.test}</span> : null}</div>
          ))}
          {view.grazeSave ? (
            <div><Button size='xs' aria-label='save graze' title='turn the graze into a hit' onClick={grazeSave}>save graze <Cost cost={view.grazeSave} /></Button></div>
          ) : null}
          {open.spell && open.roll?.degree !== 'hit' ? <div className='text-sm text-muted'>the spell fails</div> : null}
          {open.reactions.filter((r) => r.roll).map((r) => (
            <RollLine key={`${r.actor}:${r.label}`} roll={r.roll} label={`${r.actor} ${r.label}`} className='text-xs text-muted' />
          ))}
          {view.outcomes.map(({ target, outcome }) => <OutcomeLine key={target} outcome={outcome} target={target} />)}
          {open.along !== null ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>on a hit</SectionLabel>
              <Button size='xs' selected={open.along}
                title='a hit only lands if you commit yourself too'
                onClick={() => choose({ along: !open.along })}>
                {open.maneuver === 'knockdown' ? 'throw yourself along' : 'stay immobile yourself'}
              </Button>
            </div>
          ) : null}
          {open.disarm.length > 0 ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              <SectionLabel>take</SectionLabel>
              {open.disarm.map((d) =>
                <Button key={d.itemId} size='xs' selected={d.itemId === open.item}
                  onClick={() => choose({ item: d.itemId })}>{d.name}</Button>)}
            </div>
          ) : null}
          {open.grapple.map((n, i) => <div key={i} className='text-sm'>{n.target ? `${n.target}: ` : ''}<span className='text-muted'>{n.text}</span></div>)}
          {open.area && view.outcomes.length === 0 ? <div className='text-sm text-muted'>nobody in the area</div> : null}
          <div className='flex flex-row gap-1.5'>
            {view.restMove ? <Button aria-label='move while resting' onClick={restMove}>move while resting</Button> : null}
            <Button variant='primary' aria-label='resolve action' disabled={step === 'choose'} onClick={resolve}>done</Button>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

// What is prepared in the round, for the table to read.
function Prepared({ rows }: { rows: { id: string, actor: string, text: string }[] }){
  if (rows.length === 0) return null
  return (
    <div className='flex flex-col gap-1 pt-2 mt-2 border-t border-line'>
      <SectionLabel>prepared</SectionLabel>
      {rows.map((r) => <span key={r.id} className='text-xs text-muted'>{r.actor}: {r.text}</span>)}
    </div>
  )
}

function Declaration({ open, attacks, onAttack }: { open: OpenActionView, attacks: AttackOptionView[], onAttack: (s: AttackOptionView) => void }){
  if (attacks.length > 0) {
    return (
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>attack</SectionLabel>
        {attacks.map((s) =>
          <Button key={`${s.weaponKey}:${s.attack}:${s.variant}`} size='xs' selected={s.selected}
            title={`blunt ${s.blunt} · cut ${s.cut}${s.penalty ? ` · ${-s.penalty} to hit` : ''}${s.reach !== null ? ` · ${s.reach}m · -${s.distance}/20m` : ''}`}
            onClick={() => onAttack(s)}>
            {s.weapon} {s.attack} {s.variant} <Cost cost={{ AP: s.AP, STA: s.STA }} />{s.distance !== null ? <span className='ml-1 font-mono text-muted'>-{s.distance}/20m</span> : null}
          </Button>)}
      </div>
    )
  }
  if (!open.attack) return null
  return (
    <div className='text-xs text-muted'>
      {open.opportunity ? <span className='text-bad'>opportunity · </span> : null}
      {open.attack} {open.variant} <Cost cost={open.cost} />
      {open.reactions.map((r) => <span key={`${r.actor}:${r.label}`}> · {r.actor} {r.label} <Cost cost={r.cost} /></span>)}
    </div>
  )
}

type SweepDirection = StrikeAction['sweepDirection']

// combat.tex "Sweeping Attack": "Decide whether to attack from right to left
// or vice versa".
function SweepDirections({ direction, onTurn }: { direction: SweepDirection, onTurn: (direction: SweepDirection) => void }){
  return <>{(['clockwise', 'counterclockwise'] as const).map((d) =>
    <Button key={d} size='xs' selected={direction === d} onClick={() => onTurn(d)}>{d}</Button>)}</>
}

// A reactor who has chosen an opportunity attack declares the strike it
// opens here — the row and where it aims. The panel's back takes the choice
// itself back.
function ReactorStrike({ reactor, onAmend }: { reactor: ReactorOptions, onAmend: (fields: Partial<ActionDraft>) => void }){
  const strike = reactor.strike!
  const chosen = reactor.options.find((o) => o.chosen)
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>{reactor.name}</SectionLabel>
        <span className='text-xs'>{chosen?.label ?? (strike.shot ? 'join shot' : 'opportunity attack')}</span>
        {strike.partner ? (['strike', 'grapple'] as const).map((m) =>
          <Button key={m} size='xs' selected={strike.mode === m} onClick={() => onAmend({ mode: m })}>{m === 'grapple' ? 'maneuver' : 'strike'}</Button>) : null}
      </div>
      {strike.mode === 'grapple' ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>maneuver</SectionLabel>
          {strike.maneuvers.map((m) => <Button key={m} size='xs' selected={strike.maneuver === m} onClick={() => onAmend({ maneuver: m })}>{m}</Button>)}
        </div>
      ) : null}
      {strike.mode === 'strike' ? <>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>attack</SectionLabel>
        {strike.options.map((s) => {
          const active = s.attack === strike.attack && s.variant === strike.variant
          return (
            <Button key={`${s.weaponKey}:${s.attack}:${s.variant}`} size='xs' selected={active}
              title={`blunt ${s.blunt} · cut ${s.cut}${s.penalty ? ` · ${-s.penalty} to hit` : ''}`}
              onClick={() => onAmend({ weaponKey: s.weaponKey, attack: s.attack, variant: s.variant })}>
              {s.weapon} {s.attack} {s.variant} <Cost cost={{ AP: s.AP, STA: s.STA }} />{s.distance !== null ? <span className='ml-1 font-mono text-muted'>-{s.distance}/20m</span> : null}
            </Button>
          )
        })}
      </div>
      {strike.sweepDirection ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>sweep</SectionLabel>
          <SweepDirections direction={strike.sweepDirection} onTurn={(sweepDirection) => onAmend({ sweepDirection })} />
        </div>
      ) : null}
      {strike.ammo.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>loaded with</SectionLabel>
          {strike.ammo.map((a) =>
            <Button key={a.itemId} size='xs' selected={a.itemId === strike.ammoId}
              onClick={() => onAmend({ ammoId: a.itemId })}>{a.name} <span className='font-mono text-muted'>×{a.amount}</span></Button>)}
        </div>
      ) : null}
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>aim</SectionLabel>
        {strike.locations.map((l) =>
          <Button key={l.part ?? l.location} size='xs' selected={l.selected}
            title={l.penalty ? `${-l.penalty} to hit` : 'no penalty'}
            onClick={() => onAmend({ location: l.location, part: l.part })}>
            {l.name}{l.penalty ? <span className='ml-1 font-mono text-bad'>−{l.penalty}</span> : null}
          </Button>)}
      </div>
      <StrikeModifiers modifiers={strike.modifiers} onPress={onAmend} />
      {!strike.complete ? <span className='text-xs text-muted'>{strike.attack ? (strike.shot ? 'that shot cannot be made from there, or has nothing to load it with' : 'that attack cannot be made from there as declared') : 'pick the attack'}</span> : null}
      </> : null}
    </div>
  )
}

// The test as it stands, and what each side adds up from. An explosion has
// no attacker's side: its DL is what the reactors' reflexes are rolled against.
function Test({ open }: { open: OpenActionView }){
  return (
    <div className='flex flex-col text-xs text-muted'>
      {open.score.terms.length > 0 ? <TermLine label='score' terms={open.score.terms} total={open.score.total} /> : null}
      <TermLine label='vs DL' terms={open.DL.terms} total={open.DL.total} />
    </div>
  )
}

function TermLine({ label, terms, total }: { label: string, terms: Term[], total: number }){
  const shown = terms.filter((t) => t.value !== 0)
  return (
    <span>
      {label} <span className='font-mono text-fg'>{total}</span>
      {shown.length > 0 ? <> = {shown.map((t) => `${t.label} ${signed(t.value)}`).join(' · ')}</> : null}
    </span>
  )
}


// A spell to cast, on the focus surge or quickened without it
// (spells.tex "Quicken Spell").
// Items at hand to pick one from, nothing when there is no choice.
function GearPicker({ label, options, selected, onPick }: { label: string, options: CastGearOption[], selected: string, onPick: (itemId: string) => void }){
  if (options.length === 0) return null
  return(
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>{label}</SectionLabel>
      {options.map((g) => (
        <Button key={g.itemId} size='xs' selected={g.itemId === selected}
          onClick={() => onPick(g.itemId)}>
          {g.name} <span className='text-muted'>{g.held ? 'in hand' : 'quick slot'}</span>
        </Button>
      ))}
    </div>
  )
}

function SpellButton({ option, onCast, onQuicken }: { option: SpellOptionView, onCast: () => void, onQuicken: () => void }){
  return (
    <span className='inline-flex items-stretch'>
      <Button size='xs' className={option.quickenable ? 'rounded-r-none' : ''} disabled={!option.castable} title={option.reason ?? undefined} onClick={onCast}>
        {option.name} <span className='font-mono text-muted'>DL {option.DL ?? '?'}</span> <Cost cost={option.cost} />
        {option.conditions ? <span className='text-muted'> · if {option.conditions}</span> : null}
      </Button>
      {option.quickenable ? <Button size='xs' className='rounded-l-none border-l-0' title={`quicken: DL ${option.quickenedDL ?? ''}, no surge`} onClick={onQuicken}>quicken</Button> : null}
    </span>
  )
}

// spells.tex "Spell Improvements": bought out of the cast's HOP, and taken
// back while nothing has been produced yet.
function ImprovementButton({ option, onBuy, onRefund }: { option: ImprovementOption, onBuy: () => void, onRefund: () => void }){
  const bought = option.times > 0
  return (
    <span className='inline-flex items-stretch'>
      <Button size='xs' selected={bought} className={bought ? 'rounded-r-none' : ''}
        disabled={!option.available} title={option.text} onClick={onBuy}>
        {option.name} <span className='font-mono text-muted'>{option.HOP}</span>
        {bought ? <span className='ml-1 font-mono'>×{option.times}</span> : null}
        {option.needed > 0 ? <span className='ml-1 text-muted'>needs {option.needed}</span> : null}
      </Button>
      {bought ? <Button size='xs' selected className='rounded-l-none border-l-0' aria-label={`refund ${option.name}`} onClick={onRefund}>−</Button> : null}
    </span>
  )
}

function MovementButton({ option, active, onClick }: { option: MovementOption, active: boolean, onClick: () => void }){
  return (
    <Button size='xs' selected={active}
      disabled={!option.available} title={option.reason ?? `${option.speed} m per block`} onClick={onClick}>
      {option.kind} <Cost cost={option.block} />
    </Button>
  )
}

// Why a closed button is closed, on hover. A disabled button takes no mouse
// events, so the hover lands on the wrapper and the button lets it through.
function Closed({ reason, children }: { reason: string | null | undefined, children: React.ReactNode }){
  if (!reason) return <>{children}</>
  return <Tooltip text={reason} className='cursor-help [&>button]:pointer-events-none'>{children}</Tooltip>
}

function OptionButton({ option, active = false, onClick }: { option: ActionOptionView, active?: boolean, onClick: () => void }){
  return (
    <Closed reason={option.available ? null : option.reason}>
      <Button size='xs' selected={active}
        disabled={!option.available} onClick={onClick}>
        {option.label} <Cost cost={option.cost} />
        {option.surge ? <span className='ml-1 text-accent'>{option.surge} surge</span> : null}
      </Button>
    </Closed>
  )
}

// A purchase: click to buy, and once bought a second control to take it
// back — the die is thrown but nothing has landed yet.
function HOPButton({ option, onBuy, onRefund }: { option: HOPOptionView, onBuy: () => void, onRefund: () => void }){
  const bought = option.bought > 0
  return (
    <span className='inline-flex items-stretch'>
      <Closed reason={option.available ? null : option.reason}>
      <Button size='xs' selected={bought} className={bought ? 'rounded-r-none' : ''}
        disabled={!option.available} onClick={onBuy}>
        {option.label} <span className='font-mono text-muted'>{option.cost} HOP</span>
        {option.price ? <> + <Cost cost={option.price} /></> : null}
        {bought ? <span className='ml-1 font-mono'>×{option.bought}</span> : null}
      </Button>
      </Closed>
      {bought ? <Button size='xs' selected className='rounded-l-none border-l-0' aria-label={`refund ${option.label}`} onClick={onRefund}>−</Button> : null}
    </span>
  )
}

// The round so far, newest first: what was changed by hand since the last
// action, then each action played out with everything it drew. The newest
// stands open; the others fold to a line.
export function ActionLog(){
  const { view } = useCombatActions()
  const { episodes, edits } = view
  if (episodes.length === 0 && edits.length === 0) return <span className='text-xs text-muted'>nothing played this round</span>
  return (
    <div className='flex flex-col gap-1.5'>
      {edits.map((e, i) => <span key={i} className='text-xs text-muted'>since: {e}</span>)}
      {episodes.map((episode, i) => <Report key={episodes.length - i} episode={episode} open={i === 0} />)}
    </div>
  )
}

// What an action played out came to, with everything it drew — the answers
// given to it, what those opened, the follow-ups it left — in the order they
// landed.
function Report({ episode, open }: { episode: EpisodeEntry[], open: boolean }){
  const head = episode[0]
  return (
    <details open={open} className='border-b border-line/50 pb-1.5'>
      <summary className='cursor-pointer select-none text-sm'>
        {head.actor} · {head.label}
        {head.roll ? <span className={`ml-2 text-xs ${head.roll.degree === 'miss' ? 'text-bad' : head.roll.degree === 'hit' || head.roll.degree === 'critical' ? 'text-good' : 'text-muted'}`}>{head.roll.degree}</span> : null}
        {head.outcomes.map((o) => <span key={o.target} className='ml-2 text-xs text-muted'>{o.target}{o.outcome.tier !== null ? ` T${o.outcome.tier}` : ''}{o.outcome.dead ? ' dead' : ''}</span>)}
      </summary>
      <div className='flex flex-col gap-2 pt-1'>
        {episode.map((entry, i) => <ReportEntry key={i} entry={entry} />)}
      </div>
    </details>
  )
}

function ReportEntry({ entry }: { entry: EpisodeEntry }){
  return (
    <div className='flex flex-col gap-1'>
      {entry.hiddenFrom ? <span className='text-xs text-muted'>{entry.hiddenFrom}</span> : null}
      {entry.detections.map((d, i) => (
        <span key={i} className='text-xs text-muted'>
          {d.text}{d.terms.length > 0 ? ` (${d.terms.map((t) => `${t.label} ${signed(t.value)}`).join(' · ')})` : ''}
        </span>
      ))}
      <div className='flex flex-row flex-wrap gap-x-3 items-baseline'>
        <span className='text-sm'>{entry.actor} · {entry.label}</span>
        <span className='text-xs text-muted opacity-60'>{entry.rule}</span>
        <Cost cost={entry.cost} />
        <RollSummary roll={entry.roll} />
        {entry.cause ? <span className='text-xs text-muted'>{entry.cause}</span> : null}      </div>
      <Breakdown terms={entry.costTerms} refunded={entry.refunded} roll={entry.roll} surged={entry.surged} changes={entry.changes} />
      {entry.reactions.map((r, i) => (
        <div key={i} className='flex flex-col pl-3'>
          <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-xs text-muted'>
            <span>{r.actor} answered: {r.label}</span>
            <span className='opacity-60'>{r.rule}</span>
            <Cost cost={r.cost} />
            <RollSummary roll={r.roll} />
          </div>
          <Breakdown terms={r.costTerms} refunded={r.refunded} roll={r.roll} surged={r.surged} changes={r.changes} />
        </div>
      ))}
      {entry.withdrawn.map((w, i) => (
        <div key={i} className='pl-3 text-xs text-muted'>
          {w.text}{w.surged ? ` (its ${w.surged.kind} surge was paid: −${w.surged.STA} STA, +${w.surged.AP} AP)` : ''}
        </div>
      ))}
      {entry.fate ? <div className='text-sm text-bad'>{entry.fate}</div> : null}
      {entry.outcomes.map((o, i) => (
        <div key={i} className='flex flex-col'>
          <OutcomeLine outcome={o.outcome} target={o.target} />
          {o.steps.map((step, j) => (
            <span key={j} className='pl-3 text-xs text-muted'>{step.text} <span className='opacity-60'>· {step.rule}</span></span>
          ))}
        </div>
      ))}
      {entry.notes.map((n, i) => <div key={i} className='text-sm'>{n.target}: <span className='text-muted'>{n.text}</span></div>)}
      {entry.outcomes.length === 0 && entry.notes.length === 0 && !entry.fate ? <span className='text-xs text-muted'>nothing landed</span> : null}
    </div>
  )
}

// Where the numbers came from: the surge made to take the action, what its
// price adds up from, and what the test's skill and DL add up from.
function Breakdown({ terms, refunded, roll, surged, changes }: { terms: CostTerm[], refunded: number, roll: ActionRoll | null, surged: Action['surged'], changes: string[] }){
  return (
    <div className='flex flex-col text-xs text-muted'>
      {surged ? <span>{surged.kind} surge first: −{surged.STA} STA, +{surged.AP} AP</span> : null}
      {terms.length > 0 ? <span>price: {terms.map((t) => `${t.label} ${t.AP}AP${t.STA ? ` ${t.STA}STA` : ''}`).join(' · ')}</span> : null}
      {refunded > 0 ? <span>refunded: {refunded} AP from the action given up (1 AP lost)</span> : null}
      {roll && roll.skillTerms.length > 0 ? <span>skill: {roll.skillTerms.map((t) => `${t.label} ${signed(t.value)}`).join(' · ')}</span> : null}
      {roll && roll.DLTerms.length > 0 ? <span>DL: {roll.DLTerms.map((t) => `${t.label} ${signed(t.value)}`).join(' · ')}</span> : null}
      {changes.map((c, i) => <span key={i}>changed: {c}</span>)}
    </div>
  )
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function RollSummary({ roll }: { roll: ActionRoll | null }){
  if (!roll) return null
  return <span className='text-xs text-muted'>d10 <span className='font-mono text-fg'>{roll.die}</span> · <span className='font-mono text-fg'>{roll.score}</span> vs <span className='font-mono text-fg'>{roll.DL}</span> · {roll.degree}</span>
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
      {outcome.wound ? <span className='text-bad'>{outcome.wound.name}{outcome.wound.part ? ` (${outcome.wound.part.name})` : ''}{outcome.wound.heal !== null ? ` · heals at ${outcome.wound.heal} IL` : ' · no heal'}</span> : null}
      {outcome.afflictions.map((a) => <span key={a} className='text-bad'>{a}</span>)}
      {outcome.interruption !== 'none' ? <span>{outcome.interruption}{outcome.apLoss ? <> −<span className='font-mono'>{outcome.apLoss}</span> AP</> : null}</span> : null}
      {outcome.dead ? <span className='font-medium text-bad'>dead</span> : null}
    </div>
  )
}

// A test as thrown: who made it, the die, the score against the DL and the
// degree, then whatever follows from it.
function RollLine({ roll, label, className, children }: { roll: ActionRoll | null, label?: string, className: string, children?: React.ReactNode }){
  return (
    <div className={`flex flex-row flex-wrap gap-x-3 items-baseline ${className}`}>
      {label ? <span>{label}</span> : null}
      {roll ? <>
        <span>die <span className='font-mono'>{roll.die}</span></span>
        <span>score <span className='font-mono'>{roll.score}</span> vs <span className='font-mono'>{roll.DL}</span></span>
        <span className={`font-medium ${roll.degree === 'miss' ? 'text-bad' : roll.degree === 'hit' || roll.degree === 'critical' ? 'text-good' : ''}`}>{roll.degree}</span>
      </> : null}
      {children}
    </div>
  )
}

function Cost({ cost }: { cost: ActionCost | null }){
  if (!cost) return null
  return <span className='font-mono text-muted'>{cost.AP}AP{cost.STA ? ` ${cost.STA}STA` : ''}</span>
}

const PUSH_LABEL = { careful: 'push or drag', basic: 'circle', run: 'run' } as const

// A block of a push: how it moves, while that is the pusher's to say; the
// pusher's +5, and whether it counts; and whether the comparison lets it
// move as it stands.
function Push({ push, cost, onMovement, onBoost }: { push: PushView, cost: ActionCost | null, onMovement: (m: PushView['movement']) => void, onBoost: (boost: boolean) => void }){
  return (
    <div className='flex flex-col gap-1'>
      {push.movements.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>block</SectionLabel>
          {push.movements.map((m) =>
            <Button key={m.kind} size='xs' selected={m.kind === push.movement} disabled={!m.available} title={m.reason ?? undefined} onClick={() => onMovement(m.kind)}>{PUSH_LABEL[m.kind]}</Button>)}
        </div>
      ) : null}
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
        <span>cells <span className='font-mono'>{push.cells}</span> <Cost cost={cost} /></span>
        {push.movements.length > 0 && push.cells === 0 ? <span>pick the way on the board</span> : null}
        {push.canBoost ? (
          <Button size='xs' selected={push.boost} title='spend 2 AP to gain 5 force; the losing side decides first' onClick={() => onBoost(!push.boost)}>+5 force</Button>
        ) : null}
        {push.boost && !push.boosted ? <span>+5 not needed yet</span> : null}
        <span className={push.allowed ? 'text-good' : 'text-bad'}>{push.allowed ? 'moves' : 'held in place'}</span>
      </div>
    </div>
  )
}
