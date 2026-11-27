'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronUp, Dices, Hourglass, Play, X } from 'lucide-react'
import { useClickMenu, useOpenWalk } from '../hooks/useClickMenu'
import { ActionKey, Button, Closed, Floating, IconButton, SectionLabel } from './ui'
import { Locked, LockedFor } from './Locks'
import { useControlBar } from '../hooks/useControl'
import type { MenuEntry } from '../domain/scene/commands/clickMenu'
import type { AnswerWalk, DeclarationWalk, ExchangeWalk, ReactorStatus, WalkStep } from '../domain/scene/projections/openWalk'
import { ACTION_ICONS } from './actionIcons'

// Where the last press landed, which is where a click on the board opens its menu.
const pointer = { x: 0, y: 0 }
const SIDE_GAP = 16
const MENU_ROOM = 260

// The menu a click on the board opens beside the click: pick the clicked
// character, or any action the selected one could declare, under the heading
// of its category, all of them always shown. An action declared or answered
// from it is walked where it was: its declaration one step at a time to its
// commit, then the reactions one reactor at a time, each a step at a time,
// and the go; the reactions put away to a small button while none of them
// are the viewer's to make.
export function ClickMenuHost(){
  const { menu, walk, press, start, close, closeWalk, escape } = useClickMenu()
  const walked = useOpenWalk()
  const bar = useControlBar(menu?.actor ?? null)
  const [shown, setShown] = useState<string | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // where the pointer was when this menu opened, so that it stays put; the
  // walk stays where the menu it came from was
  const from = menu ?? walk?.from ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const at = useMemo(() => ({ x: pointer.x, y: pointer.y }), [from])

  useEffect(() => {
    const note = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY }
    document.addEventListener('pointerdown', note, true)
    document.addEventListener('pointermove', note, true)
    return () => { document.removeEventListener('pointerdown', note, true); document.removeEventListener('pointermove', note, true) }
  }, [])

  useEffect(() => setShown(null), [menu])

  useEffect(() => {
    // a press outside the board only closes the menu: it reaches nothing under it, nor does the release and click that follow
    const away = (e: PointerEvent) => {
      // a press on the board is the board's to read: the click that opened the menu, pressed again, picks its character
      if (panel.current?.contains(e.target as Node) || e.target instanceof HTMLCanvasElement) return
      // the walk is only put away: the action stays open in the panel, which the press reaches
      if (!menu) {
        if (walk) closeWalk()
        return
      }
      e.stopPropagation()
      close()
      const swallow = (later: Event) => later.stopPropagation()
      window.addEventListener('pointerup', swallow, { capture: true, once: true })
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => { window.removeEventListener('pointerup', swallow, true); window.removeEventListener('click', swallow, true) }, 1000)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
      // another popover or dropdown that is open takes the key first
      if (!menu && (typing || document.querySelector('[aria-expanded="true"]'))) return
      escape()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true) }
  })

  if (!menu && !walked.view) return null
  // beside the click, not under it, so that a second click on the same spot still reaches the board
  const toRight = at.x + SIDE_GAP + MENU_ROOM <= window.innerWidth
  const place = (
    <div ref={anchor} aria-hidden style={{ position: 'fixed', left: toRight ? at.x + SIDE_GAP : at.x - SIDE_GAP, top: at.y, width: 1, height: 1 }} />
  )
  const box = 'min-w-60 flex flex-col gap-1.5 bg-raised border border-line rounded p-2 shadow-lg shadow-black/40 text-xs'

  if (!menu) {
    const { view, press: step, next, back, send, shown, expanded, show, collapse } = walked
    const on = { press: step, next, back, send }
    const small = view!.kind === 'exchange' && !expanded
    return (
      <>
        {place}
        <Floating anchor={anchor} panelRef={panel} align={toRight ? 'start' : 'end'} role='dialog' aria-label={view!.title}
          className={small ? 'flex flex-row items-center gap-1 bg-raised border border-line rounded p-1 shadow-lg shadow-black/40 text-xs' : box}>
          {view!.kind === 'declare'
            ? <DeclarationView view={view!} {...on} />
            : expanded
              ? <ExchangeView view={view!} shown={shown} onShow={show} onCollapse={() => collapse(true)} {...on} />
              : <ReactionsButton view={view!} onExpand={() => collapse(false)} send={send} />}
        </Floating>
      </>
    )
  }
  const { groups } = menu

  return (
    <>
      {place}
      <Floating anchor={anchor} panelRef={panel} align={toRight ? 'start' : 'end'} role='menu' aria-label={`actions on ${menu.title}`} className={box}>
        <SectionLabel>{menu.title}</SectionLabel>
        <Locked bar={bar} className='flex flex-col gap-1.5'>
          {menu.turn ? (
            <div className='flex flex-col gap-1 rounded border border-accent/60 bg-accent/10 p-1.5'>
              <span>{menu.turn.note}</span>
              <ActionKey look='go' icon={Play} aria-label='start turn here' disabled={menu.turn.bar !== null} onClick={start}>start turn</ActionKey>
            </div>
          ) : null}
          {groups.map(({ category, entries, open }) => {
            const expanded = groups.length === 1 || shown === category
            return (
              <div key={category} className='flex flex-col items-stretch gap-1'>
                <Button size='xs' selected={expanded} aria-expanded={expanded} aria-label={`${category} actions`} disabled={entries.length === 0} onClick={() => setShown(expanded && groups.length > 1 ? null : category)}>
                  {category} <span className='font-mono text-muted'>{open}/{entries.length}</span>
                </Button>
                {expanded ? entries.map((e, i) => <MenuEntryKey key={`${e.label}:${i}`} entry={e} onPress={() => press(e)} />) : null}
              </div>
            )
          })}
        </Locked>
      </Floating>
    </>
  )
}

function costLabel(cost: DeclarationWalk['cost']){
  return cost ? `${cost.AP} AP${cost.STA ? ` · ${cost.STA} STA` : ''}` : null
}

type WalkPresses = Pick<ReturnType<typeof useOpenWalk>, 'press' | 'next' | 'back' | 'send'>

// One step of a walk: its values, a pick made and gone on from, toggles and
// steps set and gone on from; and the step before it, gone back to.
function StepView({ walk, step, backTo, press, next, back }: { walk: string, step: WalkStep | null, backTo: WalkStep['key'] | null } & Omit<WalkPresses, 'send'>){
  return (
    <>
      {step ? (
        <div className='flex flex-col items-stretch gap-1'>
          <SectionLabel>{step.label}{step.now !== null ? <span className='font-mono text-muted'> {step.now}</span> : null}</SectionLabel>
          <div className='flex flex-row flex-wrap gap-1'>
            {step.buttons.map((b, i) => (
              <Closed key={`${b.label}:${i}`} reason={b.bar ?? null}>
                <Button size='xs' selected={b.selected} disabled={!!b.bar || (step.kind !== 'pick' && b.command === null)}
                  onClick={() => press(walk, step, b)}>{b.label}</Button>
              </Closed>
            ))}
          </div>
          {step.note ? <span className='text-[11px] font-mono text-muted'>{step.note}</span> : null}
        </div>
      ) : null}
      {backTo || step?.keep ? (
        <div className='flex flex-row gap-1'>
          {backTo ? <Button size='xs' weight='ghost' onClick={() => back(walk, backTo)}>back</Button> : null}
          {step?.keep ? <Button size='xs' weight='subtle' onClick={() => next(walk, step)}>{step.kind === 'pick' ? 'keep' : 'next'}</Button> : null}
        </div>
      ) : null}
    </>
  )
}

// The open action's declaration, one step at a time, then the commit.
function DeclarationView({ view, send, ...on }: { view: DeclarationWalk } & WalkPresses){
  const { drop, commit } = view
  return (
    <>
      <div className='flex flex-row items-center justify-between gap-2'>
        <SectionLabel>{view.title} {view.cost ? <span className='font-mono text-muted'>{costLabel(view.cost)}</span> : null}</SectionLabel>
        {drop ? <LockedFor id={view.actorId}><IconButton icon={X} aria-label={drop.label} title={drop.label} onClick={() => send(drop.command)} /></LockedFor> : null}
      </div>
      <LockedFor id={view.actorId} className='flex flex-col gap-1.5'>
        {view.step ? null : (
          <Closed reason={commit.bar}>
            <ActionKey look='go' icon={commit.label === 'hold' ? Hourglass : Check} aria-label={`${commit.label} action`} disabled={commit.bar !== null} cost={costLabel(view.cost)} onClick={() => send(commit.command)}>{commit.label}</ActionKey>
          </Closed>
        )}
        <StepView walk={view.walk} step={view.step} backTo={view.back} {...on} />
      </LockedFor>
    </>
  )
}

const STATUS_LABEL: Record<ReactorStatus, string> = { waiting: 'waiting', open: 'may react', reacting: 'reacting', passed: 'passed', done: 'done' }

// The reactions put away: how many are made, whom the action waits on, and
// the actor's go once it is open.
function ReactionsButton({ view, onExpand, send }: { view: ExchangeWalk, onExpand: () => void, send: WalkPresses['send'] }){
  const { go } = view
  return (
    <>
      <Button size='xs' aria-expanded={false} aria-label='show the reactions' onClick={onExpand}>
        reactions <span className='font-mono text-muted'>{view.reacted}/{view.answerers.length}</span>
      </Button>
      {view.awaited.length > 0 ? <span className='text-accent'>waiting on {view.awaited.join(', ')}</span> : null}
      {go.bar === null ? (
        <LockedFor id={view.actorId}>
          <ActionKey look='go' icon={go.label === 'roll' ? Dices : Play} aria-label={`${go.label} action`} onClick={() => send(go.command)}>{go.label}</ActionKey>
        </LockedFor>
      ) : null}
    </>
  )
}

// The reactions to the committed action: a chip for each reactor and where
// they stand, the one shown walked a step at a time; then the actor's go.
function ExchangeView({ view, shown, onShow, onCollapse, send, ...on }: { view: ExchangeWalk, shown: string | null, onShow: (a: AnswerWalk) => void, onCollapse: () => void } & WalkPresses){
  const { go, back, accept } = view
  const reactor = view.answerers.find((a) => a.id === shown) ?? null
  return (
    <>
      <div className='flex flex-row items-center justify-between gap-2'>
        <SectionLabel>{view.title}</SectionLabel>
        <IconButton icon={ChevronUp} aria-label='put the reactions away' title='put the reactions away' onClick={onCollapse} />
      </div>
      {view.answerers.length > 1 ? (
        <div className='flex flex-row flex-wrap gap-1'>
          {view.answerers.map((a) => (
            <Button key={a.id} size='xs' selected={a.id === shown} title={a.answer ?? undefined} onClick={() => onShow(a)}>
              <span className={a.target ? 'text-accent' : ''}>{a.name}</span> <span className='text-muted'>{STATUS_LABEL[a.status]}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {reactor ? <AnswerView answerer={reactor} send={send} {...on} /> : <span className='text-muted'>nobody reacts</span>}
      {view.heldBack.map((h) => (
        <LockedFor key={h.id} id={h.id} className='flex flex-row flex-wrap gap-1 items-center text-muted'>
          <span>{h.name} does not act against allies</span>
          <Button size='xs' weight='subtle' onClick={() => send(h.command)}>react anyway</Button>
        </LockedFor>
      ))}
      {view.hint ? <span className='text-muted'>{view.hint}</span> : null}
      {view.awaited.length > 0 ? <span className='text-accent'>waiting on {view.awaited.join(', ')}</span> : null}
      {view.testMode.length > 0 ? (
        <LockedFor id={view.targetId} className='flex flex-row flex-wrap gap-1'>
          {view.testMode.map((b) => <Button key={b.label} size='xs' selected={b.selected} disabled={b.command === null} onClick={() => b.command && send(b.command)}>{b.label}</Button>)}
        </LockedFor>
      ) : null}
      <LockedFor id={view.actorId} className='flex flex-row gap-1'>
        <Closed reason={go.bar}>
          <ActionKey look='go' icon={go.label === 'roll' ? Dices : Play} aria-label={`${go.label} action`} disabled={go.bar !== null} onClick={() => send(go.command)}>{go.label}</ActionKey>
        </Closed>
        {back ? <Button size='xs' weight='ghost' title='take back the last reaction' onClick={() => send(back)}>take back</Button> : null}
      </LockedFor>
      {accept ? <LockedFor id={view.targetId}><ActionKey title='the target allows it: no test' onClick={() => send(accept)}>allow it</ActionKey></LockedFor> : null}
    </>
  )
}

// One reactor's reaction, a step at a time, then their word that they are done.
function AnswerView({ answerer: a, send, ...on }: { answerer: AnswerWalk } & WalkPresses){
  const { done } = a
  return (
    <LockedFor id={a.id} className={`flex flex-col gap-1 ${a.target ? 'rounded border border-accent/60 bg-accent/5 p-1.5' : ''}`}>
      <span className={a.target ? 'text-accent' : ''}>{a.name}{a.answer && !a.step ? <span className='text-muted'>: {a.answer}</span> : null}</span>
      {a.cancellable ? <span className='text-bad'>defending actively gives up the {a.cancellable}</span> : null}
      <StepView walk={a.walk} step={a.step} backTo={a.back} {...on} />
      {!a.step && done ? (
        done.state === 'said'
          ? <span className='text-good'>done</span>
          : (
            <Closed reason={done.state === 'closed' ? 'the reaction is not finished' : null}>
              <ActionKey look='go' icon={Check} aria-label={`${a.name} done reacting`} disabled={done.state === 'closed'} onClick={() => send(done.command)}>done</ActionKey>
            </Closed>
          )
      ) : null}
    </LockedFor>
  )
}

// One entry of what a character may declare or answer: what it is, its price,
// the surge it is made on, and why it is closed when it is. The board's menu
// and the action panel both show entries this way.
export function MenuEntryKey({ entry, onPress }: { entry: MenuEntry, onPress: () => void }){
  return (
    <Closed reason={entry.bar}>
      <ActionKey icon={entry.press.kind === 'declare' ? ACTION_ICONS[entry.press.draft.kind] : undefined} disabled={entry.bar !== null}
        cost={entry.cost ? `${entry.cost.AP} AP${entry.cost.STA ? ` · ${entry.cost.STA} STA` : ''}` : null} onClick={onPress}>
        {entry.label}{entry.surge ? <span className='text-accent'> {entry.surge} surge</span> : null}
      </ActionKey>
    </Closed>
  )
}
