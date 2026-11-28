'use client'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, ChevronUp, Dices, Hourglass, Lock, Minus, Play, X, type LucideIcon } from 'lucide-react'
import { useClickMenu, useOpenWalk, usePopoverSpot } from '../hooks/useClickMenu'
import { ActionKey, Button, Closed, Floating, IconButton } from './ui'
import { LockedFor } from './Locks'
import type { ClickMenu, MenuEntry } from '../domain/scene/commands/clickMenu'
import type { AnswerWalk, DeclarationWalk, ExchangeWalk, LandingWalk, ReactorStatus, WalkButton, WalkStep } from '../domain/scene/projections/openWalk'
import type { ActionCost } from '../domain/character/rules/actionCosts'
import type { Degree } from '../domain/types'
import type { Damage } from '../domain/character/rules/gear'
import { ACTION_ICONS, CATEGORY_ICONS } from './actionIcons'
import { useKeyMap } from '../hooks/useKeyMap'
import { TILE_COMMANDS, findKey, isKey, keyLabel, type KeyMap } from '../keys'

// Where the last press landed, which is where a click on the board opens its menu.
const pointer = { x: 0, y: 0 }
const SIDE_GAP = 16
const MENU_ROOM = 340

// One screen of the popover: a set of numbered tiles, the first nine pressed
// by a key as well, and a footer that stays put from screen to screen, back
// on its left and the press that goes on on its right (going on, committing,
// rolling, landing), and another key cancels what the screen is choosing. Which keys they are is the key
// profile's (app/keys.ts).
type Tile = { key: string; label: ReactNode; icon?: LucideIcon; cost?: ActionCost | null; damage?: Damage; note?: ReactNode; hint?: string; selected?: boolean; bar?: string | null; count?: number; run: () => void; undo?: (() => void) | null }
type Act = { label: string; run: () => void; bar?: string | null; icon?: LucideIcon }
type Card = {
  title: ReactNode
  meta?: ReactNode
  head?: ReactNode
  top?: ReactNode
  label?: ReactNode
  tiles: Tile[]
  below?: ReactNode
  lock: string | null
  back: Act | null
  primary: Act | null
  primaryLock?: string | null
  cancel: () => void
}

// The menu a click on the board opens beside the click: its categories, each
// opening a screen of the actions the selected one could declare under it,
// all of them always shown, and the start of the turn where it is yet to
// start. An action declared or answered from it is walked where it was: its
// declaration one step at a time to a summary and its commit, then the
// reactions one reactor at a time, each a step at a time, and the go; the
// reactions put away to a small button while none of them are the viewer's
// to make; then whatever the roll leaves to choose, a step at a time, the
// last landing it; then whatever follows from it, the same way.
export function ClickMenuHost(){
  const { menu, shown: category, show: showCategory, walk, press, start, close, closeWalk, escape, openCategory, goOn } = useClickMenu()
  const walked = useOpenWalk()
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // where the pointer was when this menu opened, so that it stays put; the
  // walk stays where the menu it came from was
  const from = menu ?? walk?.from ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const at = useMemo(() => ({ x: pointer.x, y: pointer.y }), [from])
  // dragged by its title bar, for as long as the menu or walk it opened for lasts
  const [dragged, setDragged] = useState<{ from: typeof from, x: number, y: number } | null>(null)
  const moved = dragged && dragged.from === from ? dragged : { x: 0, y: 0 }
  const drag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const start = { x: e.clientX - moved.x, y: e.clientY - moved.y }
    const move = (m: PointerEvent) => setDragged({ from, x: m.clientX - start.x, y: m.clientY - start.y })
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const { view, expanded } = walked
  const keys = useKeyMap()
  const small = !menu && view?.kind === 'exchange' && !expanded
  const spot = usePopoverSpot(!!menu || (!!view && !small))
  const card: Card | null = menu ? menuCard(menu, category, { press, start, close, show: showCategory })
    : !view || small ? null
    : view.kind === 'declare' ? declarationCard(view, walked, closeWalk)
    : view.kind === 'land' ? landingCard(view, walked, closeWalk)
    : exchangeCard(view, walked)
  useCardKeys(card, keys)
  useTurnKeys(!menu && !view, keys, openCategory, goOn)

  useEffect(() => {
    const note = (e: PointerEvent) => { pointer.x = e.clientX; pointer.y = e.clientY }
    document.addEventListener('pointerdown', note, true)
    document.addEventListener('pointermove', note, true)
    return () => { document.removeEventListener('pointerdown', note, true); document.removeEventListener('pointermove', note, true) }
  }, [])

  useEffect(() => {
    // a press outside the board only closes the menu: it reaches nothing under it, nor does the release and click that follow
    const away = (e: PointerEvent) => {
      // a right click is the card's own: it cancels
      if (e.button === 2) return
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
      if (!isKey(keys, 'card.cancel', e)) return
      // another popover or dropdown that is open takes the key first
      if (!menu && (isTyping(e) || document.querySelector('[aria-expanded="true"]'))) return
      if (card) card.cancel()
      else escape()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true) }
  })

  // reactions the viewer has none of to make are not shown: the action goes on once they are in
  if (!menu && (!view || small)) return null
  // beside whom it is about, or else the click, not under it, so that a second click on the same spot still reaches the board
  const where = spot ?? { ...at, radius: 0 }
  const gap = SIDE_GAP + where.radius
  const toRight = where.x + gap + MENU_ROOM <= window.innerWidth
  const place = (
    <div ref={anchor} aria-hidden style={{ position: 'fixed', left: (toRight ? where.x + gap : where.x - gap) + moved.x, top: where.y + moved.y, width: 1, height: 1 }} />
  )

  return (
    <>
      {place}
      <Floating anchor={anchor} panelRef={panel} align={toRight ? 'start' : 'end'} role={menu ? 'menu' : 'dialog'} aria-label={menu ? `actions on ${menu.title}` : view?.title}
        className='bg-raised border border-line rounded-lg shadow-xl shadow-black/50 text-xs overflow-hidden'>
        {card ? <CardView card={card} keys={keys} onDrag={drag} /> : null}
      </Floating>
    </>
  )
}

function isTyping(e: Event): boolean {
  return e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))
}

// The card's keys, as the key profile binds them: a tile's key presses it,
// and back, going on and cancel each have theirs; cancel may be the right
// button too. A key nothing on the card takes is left to whatever else
// answers to it (the contest).
function useCardKeys(card: Card | null, keys: KeyMap){
  const current = useRef<{ card: Card | null, keys: KeyMap }>({ card: null, keys })
  useEffect(() => { current.current = { card, keys } })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { card: c, keys: map } = current.current
      if (!c || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return
      if (isKey(map, 'card.back', e)) {
        e.preventDefault()
        e.stopPropagation()
        if (c.back && !c.back.bar) c.back.run()
        return
      }
      if (isKey(map, 'card.next', e)) {
        if (!c.primary || c.primary.bar) return
        e.preventDefault()
        if (!e.repeat) c.primary.run()
        return
      }
      const pressed = findKey(map, TILE_COMMANDS, e)
      const tile = pressed ? c.tiles[TILE_COMMANDS.indexOf(pressed)] : undefined
      if (!tile || tile.bar) return
      e.preventDefault()
      tile.run()
    }
    const context = (e: MouseEvent) => {
      const { card: c, keys: map } = current.current
      if (!c) return
      e.preventDefault()
      if (isKey(map, 'card.cancel', e)) c.cancel()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('contextmenu', context, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('contextmenu', context, true) }
  }, [])
}

// With no card open, a tile's key opens the menu of the character holding the
// turn at the category of that tile, aimed at nothing, and the key that goes
// on brings back the open action or starts the turn of whoever is picked.
function useTurnKeys(idle: boolean, keys: KeyMap, open: (tile: number) => void, goOn: () => boolean){
  const current = useRef({ idle, keys, open, goOn })
  useEffect(() => { current.current = { idle, keys, open, goOn } })
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { idle: free, keys: map, open: opening, goOn: going } = current.current
      if (!free || e.defaultPrevented || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (isKey(map, 'card.next', e)) {
        if (going()) e.preventDefault()
        return
      }
      const pressed = findKey(map, TILE_COMMANDS, e)
      if (!pressed) return
      e.preventDefault()
      opening(TILE_COMMANDS.indexOf(pressed))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
}

function costLabel(cost: ActionCost | null | undefined){
  return cost ? `${cost.AP} AP${cost.STA ? ` · ${cost.STA} STA` : ''}` : null
}

// A tile hovered tells what it does over the foot of the card, taking no room.
function CardView({ card, keys, onDrag }: { card: Card, keys: KeyMap, onDrag: (e: ReactPointerEvent) => void }){
  const { back, primary } = card
  const [hint, setHint] = useState<string | null>(null)
  const hinted = hint !== null && card.tiles.some((t) => t.hint === hint) ? hint : null
  return (
    <div className='flex h-[26rem] w-80 flex-col'>
      <div className='flex cursor-move touch-none flex-row items-center gap-2 border-b border-line px-3 py-2' title='drag to move' onPointerDown={onDrag}>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{card.title}</span>
        {card.meta ? <span className='font-mono text-[10px] text-muted'>{card.meta}</span> : null}
        {card.head}
      </div>
      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2'>
          {card.top}
          {card.label ? <span className='text-[10px] uppercase tracking-wider text-muted'>{card.label}</span> : null}
          {card.tiles.length > 0 ? (
            <LockedFor id={card.lock} className='grid grid-cols-3 gap-1.5'>
              {card.tiles.map((t, i) => <TileView key={t.key} tile={t} n={TILE_COMMANDS[i] ? keyLabel(keys, TILE_COMMANDS[i]) : null} onHint={setHint} />)}
            </LockedFor>
          ) : null}
          {card.below}
        </div>
        {hinted ? <div className='pointer-events-none absolute inset-x-0 bottom-0 border-t border-accent/60 bg-raised/95 px-3 py-2 text-[11px] leading-snug text-fg'>{hinted}</div> : null}
      </div>
      <div className='flex flex-row items-center gap-2 border-t border-line bg-surface/60 p-2'>
        <FootKey act={back} fallback='back' hint={keyLabel(keys, 'card.back')} className='w-24' />
        <span className='flex-1' />
        <LockedFor id={card.primaryLock === undefined ? card.lock : card.primaryLock}>
          <FootKey act={primary} hint={keyLabel(keys, 'card.next')} look='go' className='w-36' />
        </LockedFor>
      </div>
    </div>
  )
}

// A footer key: there whether or not it may be pressed, so that the footer
// never moves.
function FootKey({ act, fallback, hint, look = 'plain', className }: { act: Act | null, fallback?: string, hint: string, look?: 'plain' | 'go', className: string }){
  if (!act && !fallback) return <span className={className} />
  const Icon = act?.icon ?? (look === 'plain' ? ChevronLeft : ChevronRight)
  return (
    <Closed reason={act?.bar ?? null}>
      <ActionKey look={act ? look : 'plain'} icon={Icon} disabled={!act || !!act.bar} onClick={act?.run} className={`justify-center py-2 text-sm ${className}`}>
        {act?.label ?? fallback}<span className='font-mono text-[9px] font-normal opacity-60'>{hint}</span>
      </ActionKey>
    </Closed>
  )
}

function DamageLine({ damage: { blunt, cut } }: { damage: Damage }){
  if (!blunt && !cut) return null
  return (
    <span className='font-mono text-[10px] text-fg/80'>
      {blunt ? `${blunt} blunt` : null}{blunt && cut ? ' · ' : null}{cut ? `${cut} cut` : null}
    </span>
  )
}

function TileView({ tile: t, n, onHint }: { tile: Tile, n: string | null, onHint: (hint: string | null) => void }){
  const closed = !!t.bar
  const Icon = t.icon
  const look = closed ? 'border-dashed border-line bg-bg text-muted cursor-not-allowed'
    : t.selected ? 'border-accent bg-linear-to-b from-accent/25 to-accent/10 text-accent shadow-[0_2px_0_0_rgb(0_0_0/0.45)] cursor-pointer'
    : 'border-line bg-linear-to-b from-raised to-surface text-fg hover:border-accent shadow-[0_2px_0_0_rgb(0_0_0/0.45),inset_0_1px_0_0_rgb(255_255_255/0.06)] cursor-pointer'
  return (
    <div className='relative flex' onPointerEnter={() => onHint(t.hint ?? null)} onPointerLeave={() => onHint(null)}>
      <button type='button' disabled={closed} onClick={t.run}
        className={`relative flex min-h-[4.75rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-md border px-1 pb-1.5 pt-4 text-center leading-tight transition-[transform,box-shadow,border-color] active:translate-y-[2px] active:shadow-none focus-visible:outline-2 focus-visible:outline-accent ${look}`}>
        {n ? <span className='absolute left-1 top-1 rounded border border-line px-1 font-mono text-[9px] leading-3 text-muted'>{n}</span> : null}
        {t.count ? <span className='absolute right-1 top-1 rounded bg-accent px-1 font-mono text-[9px] font-bold leading-3 text-bg'>×{t.count}</span> : null}
        {Icon ? <Icon size={18} aria-hidden /> : null}
        <span className='text-[11px] font-semibold'>{t.label}</span>
        {t.cost ? (
          <span className='font-mono text-[10px]'>
            <span className={closed ? '' : 'text-ap-2'}>{t.cost.AP} AP</span>{t.cost.STA ? <span className={closed ? '' : 'text-sta-2'}> {t.cost.STA} STA</span> : null}
          </span>
        ) : null}
        {t.damage ? <DamageLine damage={t.damage} /> : null}
        {closed ? <span className='flex flex-row items-center gap-0.5 text-[9px]'><Lock size={9} aria-hidden />{t.bar}</span> : t.note ? <span className='text-[9px] text-muted'>{t.note}</span> : null}
      </button>
      {t.undo ? (
        <button type='button' aria-label='take one back' onClick={t.undo}
          className='absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-line bg-surface text-fg hover:border-accent cursor-pointer'>
          <Minus size={11} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

type MenuPresses = { press: (e: MenuEntry) => void, start: () => void, close: () => void, show: (category: string | null) => void }

function entryIcon(e: MenuEntry): LucideIcon | undefined {
  return e.press.kind === 'declare' || e.press.kind === 'answer' ? ACTION_ICONS[e.press.draft.kind] : undefined
}

// The menu: its categories, or the actions of the one shown.
function menuCard(menu: ClickMenu, shown: string | null, on: MenuPresses): Card {
  const { groups } = menu
  const group = groups.length === 1 ? groups[0] : groups.find((g) => g.category === shown) ?? null
  const top = menu.turn ? (
    <div className='flex flex-col gap-0.5 rounded border border-accent/60 bg-accent/10 px-2 py-1.5'>
      <span>{menu.turn.note}</span>
      {menu.turn.bar ? <span className='text-muted'>{menu.turn.bar}</span> : null}
    </div>
  ) : null
  const tiles: Tile[] = group
    ? group.entries.map((e, i) => ({ key: `${e.label}:${i}`, label: e.label, icon: entryIcon(e), cost: e.cost, damage: e.damage, note: e.note ?? (e.surge ? `${e.surge} surge` : null), bar: e.bar, run: () => on.press(e) }))
    : groups.map((g) => ({ key: g.category, label: g.category, icon: CATEGORY_ICONS[g.category], note: <><span className='font-mono'>{g.open}</span> of <span className='font-mono'>{g.entries.length}</span> open</>, bar: g.entries.length === 0 ? 'nothing to do' : null, run: () => on.show(g.category) }))
  return {
    title: menu.title,
    meta: group && groups.length > 1 ? group.category : null,
    top,
    tiles,
    lock: menu.actor,
    back: group && groups.length > 1 ? { label: 'back', run: () => on.show(null) } : { label: 'close', icon: X, run: on.close },
    primary: menu.turn ? { label: 'start turn', icon: Play, run: on.start, bar: menu.turn.bar } : null,
    cancel: on.close,
  }
}

type Walked = ReturnType<typeof useOpenWalk>

function stepTiles(walk: string, step: WalkStep, { press }: Pick<Walked, 'press'>): Tile[] {
  return step.buttons.map((b: WalkButton, i) => ({
    key: `${b.label}:${i}`,
    label: b.label,
    selected: b.selected,
    damage: b.damage,
    cost: b.cost,
    note: b.note,
    hint: b.hint,
    count: b.count,
    bar: b.bar ?? (step.kind !== 'pick' && b.command === null ? 'cannot be changed' : null),
    run: () => press(walk, step, b),
    undo: b.undo ? () => press(walk, step, { ...b, command: b.undo! }) : null,
  }))
}

function stepLabel(step: WalkStep){
  return <>{step.label}{step.now !== null ? <span className='font-mono normal-case'> {step.now}</span> : null}</>
}

// The open action's declaration, one step at a time, then what it is
// declared with and its commit. Back from its first step cancels it and
// opens the menu again.
function declarationCard(view: DeclarationWalk, on: Walked, closeWalk: () => void): Card {
  const { step, drop, commit } = view
  const cancel = drop?.command.kind === 'cancel' ? drop.command : null
  return {
    title: view.title,
    meta: costLabel(view.cost),
    head: drop ? <IconButton icon={X} aria-label={drop.label} title={drop.label} onClick={() => on.send(drop.command)} /> : null,
    label: step ? stepLabel(step) : 'about to happen',
    tiles: step ? stepTiles(view.walk, step, on) : [],
    below: step ? (step.note ? <span className='font-mono text-[11px] text-muted'>{step.note}</span> : null) : (
      <div className='flex flex-col'>
        {view.summary.map((s) => (
          <div key={s.label} className='flex flex-row gap-2 border-t border-line/60 py-1'>
            <span className='w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted'>{s.label}</span><span>{s.value}</span>
          </div>
        ))}
        {view.cost ? (
          <div className='flex flex-row gap-2 border-t border-line/60 py-1'>
            <span className='w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted'>cost</span><span className='font-mono'>{costLabel(view.cost)}</span>
          </div>
        ) : null}
      </div>
    ),
    lock: view.actorId,
    back: view.back ? { label: 'back', run: () => on.back(view.walk, view.back!) } : cancel ? { label: 'back', run: () => on.reopen(cancel) } : null,
    primary: step
      ? (step.keep ? { label: 'next', run: () => on.next(view.walk, step) } : null)
      : { label: commit.label, icon: commit.label === 'hold' ? Hourglass : Check, run: () => on.send(commit.command), bar: commit.bar },
    cancel: () => (drop ? on.send(drop.command) : closeWalk()),
  }
}

// What the roll leaves to choose, a step at a time; going on from the last
// lands the action.
const DEGREE_LOOK: Record<Degree, string> = { miss: 'text-bad', graze: 'text-accent', hit: 'text-good', critical: 'text-good' }

function landingCard(view: LandingWalk, on: Walked, closeWalk: () => void): Card {
  const { step, land, result, hop } = view
  return {
    title: view.title,
    top: result ? (
      <div className='flex flex-row items-baseline gap-3 border-b border-line/60 pb-2'>
        <span className={`text-lg font-bold uppercase tracking-wider ${DEGREE_LOOK[result.degree]}`}>{result.degree}</span>
        <span className='font-mono text-[11px] text-muted'>d10 {result.die} · <span className='text-fg'>{result.score}</span> vs DL <span className='text-fg'>{result.DL}</span></span>
        {hop ? <span className='ml-auto font-mono text-[11px]'><span className='text-accent'>{hop.remaining}</span><span className='text-muted'>/{hop.total} HOP</span></span> : null}
      </div>
    ) : null,
    label: step ? stepLabel(step) : null,
    tiles: step ? stepTiles(view.walk, step, on) : [],
    below: step?.note ? <span className='font-mono text-[11px] text-muted'>{step.note}</span> : null,
    lock: view.actorId,
    back: view.back ? { label: 'back', run: () => on.back(view.walk, view.back!) } : null,
    primary: step
      ? (step.keep ? { label: view.last ? 'land' : 'next', run: () => on.next(view.walk, step) } : null)
      : { label: 'land', run: () => on.send(land.command), bar: land.bar },
    cancel: closeWalk,
  }
}

const STATUS_LABEL: Record<ReactorStatus, string> = { waiting: 'waiting', open: 'may react', reacting: 'reacting', passed: 'passed', done: 'done' }

// The reactions to the committed action: a chip for each reactor and where
// they stand, the one shown walked a step at a time where they are the
// viewer's, then their word that they are done; then the actor's go. Of a
// reactor who is not theirs the viewer sees only what they react with.
function exchangeCard(view: ExchangeWalk, on: Walked): Card {
  const { go } = view
  const shown: AnswerWalk | null = view.answerers.find((a) => a.id === on.shown) ?? null
  const reactor = shown && on.controlled.includes(shown.id) ? shown : null
  const done = reactor && !reactor.step && reactor.done && reactor.done.state !== 'said' ? reactor.done : null
  const top = (
    <>
      {view.answerers.length > 1 ? (
        <div className='flex flex-row flex-wrap gap-1'>
          {view.answerers.map((a) => (
            <Button key={a.id} size='xs' selected={a.id === on.shown} title={a.answer ?? undefined} onClick={() => on.show(a)}>
              <span className={a.target ? 'text-accent' : ''}>{a.name}</span> <span className='text-muted'>{STATUS_LABEL[a.status]}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {reactor?.cancellable ? <span className='text-bad'>defending actively gives up the {reactor.cancellable}</span> : null}
    </>
  )
  const below = (
    <>
      {reactor && !reactor.step ? <span>{reactor.name}{reactor.answer ? <span className='text-muted'>: {reactor.answer}</span> : null}{reactor.done?.state === 'said' ? <span className='text-good'> · done</span> : null}</span> : null}
      {!reactor && view.answerers.length > 0 ? (
        <div className='flex flex-col'>
          {view.answerers.map((a) => (
            <div key={a.id} className='flex flex-row gap-2 border-t border-line/60 py-1'>
              <span className={`w-20 shrink-0 truncate ${a.target ? 'text-accent' : ''}`}>{a.name}</span>
              <span className={a.answer ? '' : 'text-muted'}>{a.answer ?? STATUS_LABEL[a.status]}</span>
            </div>
          ))}
        </div>
      ) : null}
      {view.answerers.length === 0 ? <span className='text-muted'>nobody reacts</span> : null}
      {view.heldBack.map((h) => (
        <LockedFor key={h.id} id={h.id} className='flex flex-row flex-wrap gap-1 items-center text-muted'>
          <span>{h.name} does not act against allies</span>
          <Button size='xs' weight='subtle' onClick={() => on.send(h.command)}>react anyway</Button>
        </LockedFor>
      ))}
      {view.hint ? <span className='text-muted'>{view.hint}</span> : null}
      {view.awaited.length > 0 ? <span className='text-accent'>waiting on {view.awaited.join(', ')}</span> : null}
      {view.testMode.length > 0 ? (
        <LockedFor id={view.targetId} className='flex flex-row flex-wrap gap-1'>
          {view.testMode.map((b) => <Button key={b.label} size='xs' selected={b.selected} disabled={b.command === null} onClick={() => b.command && on.send(b.command)}>{b.label}</Button>)}
        </LockedFor>
      ) : null}
      {view.accept ? <LockedFor id={view.targetId}><ActionKey title='the target allows it: no test' onClick={() => on.send(view.accept!)}>allow it</ActionKey></LockedFor> : null}
    </>
  )
  const primary: Act | null = done
    ? { label: 'done', icon: Check, run: () => on.send(done.command), bar: done.state === 'closed' ? 'the reaction is not finished' : null }
    : reactor?.step?.keep ? { label: 'next', run: () => on.next(reactor.walk, reactor.step!) }
    : { label: go.label, icon: go.label === 'roll' ? Dices : Play, run: () => on.send(go.command), bar: go.bar }
  return {
    title: view.title,
    head: <IconButton icon={ChevronUp} aria-label='put the reactions away' title='put the reactions away' onClick={() => on.collapse(true)} />,
    top,
    label: reactor?.step ? <>{reactor.name} · {stepLabel(reactor.step)}</> : null,
    tiles: reactor?.step ? stepTiles(reactor.walk, reactor.step, on) : [],
    below,
    lock: reactor?.id ?? null,
    back: reactor?.back ? { label: 'back', run: () => on.back(reactor.walk, reactor.back!) } : view.back ? { label: 'take back', run: () => on.send(view.back!) } : null,
    primary,
    primaryLock: done || reactor?.step?.keep ? reactor?.id ?? null : view.actorId,
    cancel: () => on.collapse(true),
  }
}

// One entry of what a character may declare or answer: what it is, its price,
// the surge it is made on, and why it is closed when it is. The action panel
// shows entries this way.
export function MenuEntryKey({ entry, onPress }: { entry: MenuEntry, onPress: () => void }){
  return (
    <Closed reason={entry.bar}>
      <ActionKey icon={entryIcon(entry)} disabled={entry.bar !== null} cost={costLabel(entry.cost)} onClick={onPress}>
        {entry.label}{entry.surge ? <span className='text-accent'> {entry.surge} surge</span> : null}
      </ActionKey>
    </Closed>
  )
}
