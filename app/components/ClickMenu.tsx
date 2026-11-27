'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Hourglass, Play, X } from 'lucide-react'
import { useClickMenu, useOpenWalk } from '../hooks/useClickMenu'
import { ActionKey, Button, Closed, Floating, IconButton, SectionLabel } from './ui'
import { Locked } from './Locks'
import { useControlBar } from '../hooks/useControl'
import type { MenuEntry } from '../domain/scene/commands/clickMenu'
import type { OpenWalk } from '../domain/scene/projections/openWalk'
import { ACTION_ICONS } from './actionIcons'

// Where the last press landed, which is where a click on the board opens its menu.
const pointer = { x: 0, y: 0 }
const SIDE_GAP = 16
const MENU_ROOM = 260

// The menu a click on the board opens beside the click: pick the clicked
// character, or any action the selected one could declare, under the heading
// of its category, all of them always shown. An action declared from it is
// walked where it was, one step of its declaration at a time, to its commit.
export function ClickMenuHost(){
  const { menu, walk, press, start, close, closeWalk, escape } = useClickMenu()
  const walked = useOpenWalk()
  const bar = useControlBar(menu?.actor ?? walk?.actorId ?? null)
  const [shown, setShown] = useState<string | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // where the pointer was when this menu opened, so that it stays put
  // the walk stays where the menu it came from was
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
    const { view, ...on } = walked
    return (
      <>
        {place}
        <Floating anchor={anchor} panelRef={panel} align={toRight ? 'start' : 'end'} role='dialog' aria-label={`declaring ${view!.title}`} className={box}>
          <WalkView view={view!} bar={bar} {...on} />
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

function costLabel(cost: OpenWalk['cost']){
  return cost ? `${cost.AP} AP${cost.STA ? ` · ${cost.STA} STA` : ''}` : null
}

// The open action's declaration, one step at a time: a pick is made and goes
// on, toggles and steps are set and gone on from; then the commit.
function WalkView({ view, bar, pick, toggle, next, back, commit, drop }: { view: OpenWalk, bar: string | null } & Omit<ReturnType<typeof useOpenWalk>, 'walk' | 'view'>){
  const { step } = view
  return (
    <>
      <div className='flex flex-row items-center justify-between gap-2'>
        <SectionLabel>{view.title} {view.cost ? <span className='font-mono text-muted'>{costLabel(view.cost)}</span> : null}</SectionLabel>
        {view.drop ? <IconButton icon={X} aria-label={view.drop.label} title={view.drop.label} onClick={drop} /> : null}
      </div>
      <Locked bar={bar} className='flex flex-col gap-1.5'>
        {step ? (
          <div className='flex flex-col items-stretch gap-1'>
            <SectionLabel>{step.label}{step.now !== null ? <span className='font-mono text-muted'> {step.now}</span> : null}</SectionLabel>
            <div className='flex flex-row flex-wrap gap-1'>
              {step.buttons.map((b, i) => (
                <Button key={`${b.label}:${i}`} size='xs' selected={b.selected} disabled={step.kind !== 'pick' && b.command === null}
                  onClick={() => (step.kind === 'pick' ? pick(b) : toggle(b))}>{b.label}</Button>
              ))}
            </div>
          </div>
        ) : (
          <Closed reason={view.commit.bar}>
            <ActionKey look='go' icon={view.commit.label === 'hold' ? Hourglass : Check} aria-label={`${view.commit.label} action`} disabled={view.commit.bar !== null} cost={costLabel(view.cost)} onClick={commit}>{view.commit.label}</ActionKey>
          </Closed>
        )}
        <div className='flex flex-row gap-1'>
          {view.back ? <Button size='xs' weight='ghost' onClick={back}>back</Button> : null}
          {step?.keep ? <Button size='xs' weight='subtle' onClick={next}>{step.kind === 'pick' ? 'keep' : 'next'}</Button> : null}
        </div>
      </Locked>
    </>
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
