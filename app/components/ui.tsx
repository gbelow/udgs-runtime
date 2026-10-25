'use client'
import { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, RefObject, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, RotateCcw, type LucideIcon } from 'lucide-react'
import type { CollectionFilter } from '../hooks/useCollections'

// The shared visual vocabulary. Colour is by meaning (see globals.css): accent
// selects, good is the pending flow, bad is harm, muted is derived or
// unavailable. Nothing here knows anything about the game.

// Weight is how much a button matters among its neighbours: solid for the one
// press that moves things on (at most one to a panel), outline for ordinary
// actions, subtle for the actions inside a row, ghost only beside a heavier
// button. Tone is what kind of thing it does, in the palette's meanings.
export type ButtonWeight = 'solid' | 'outline' | 'subtle' | 'ghost'
export type Tone = 'neutral' | 'accent' | 'good' | 'bad'

const LOOK: Record<ButtonWeight, Record<Tone, string>> = {
  solid: {
    neutral: 'border-transparent bg-fg text-bg font-medium hover:brightness-110',
    accent: 'border-transparent bg-accent text-bg font-medium hover:brightness-110',
    good: 'border-transparent bg-good text-bg font-medium hover:brightness-110',
    bad: 'border-transparent bg-bad text-bg font-medium hover:brightness-110',
  },
  outline: {
    neutral: 'border-line bg-surface text-fg hover:bg-raised hover:border-muted',
    accent: 'border-accent bg-surface text-accent hover:bg-accent/15',
    good: 'border-good bg-surface text-good hover:bg-good/15',
    bad: 'border-bad bg-surface text-bad hover:bg-bad/15',
  },
  subtle: {
    neutral: 'border-transparent bg-raised text-fg hover:bg-line',
    accent: 'border-transparent bg-accent/15 text-accent hover:bg-accent/25',
    good: 'border-transparent bg-good/15 text-good hover:bg-good/25',
    bad: 'border-transparent bg-bad/15 text-bad hover:bg-bad/25',
  },
  ghost: {
    neutral: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-fg',
    accent: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-accent',
    good: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-good',
    bad: 'border-transparent bg-transparent text-muted hover:bg-raised hover:text-bad',
  },
}

// A button held down (a menu open, a mode on, a state it is in), whatever its weight.
const PRESSED: Record<Tone, string> = {
  neutral: 'border-muted bg-raised text-fg',
  accent: 'border-accent bg-accent/15 text-accent',
  good: 'border-good bg-good/15 text-good',
  bad: 'border-bad bg-bad/15 text-bad',
}

const SIZE = {
  xs: 'text-xs px-1.5 py-px',
  sm: 'text-xs px-2.5 py-1',
  md: 'text-sm px-3 py-1',
} as const

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1'

// `selected` marks the one chosen among its siblings (a tab, a mode, a picked
// option) in the accent, whatever its tone otherwise. A closed button is drawn
// dashed and empty, so it still reads as an option, only one not open now; a
// closed one held down keeps showing the state it is held in, faded.
export function Button({ weight = 'outline', tone = 'neutral', size = 'sm', active = false, selected = false, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { weight?: ButtonWeight, tone?: Tone, size?: keyof typeof SIZE, active?: boolean, selected?: boolean }
){
  const look = selected ? PRESSED.accent : active ? PRESSED[tone] : LOOK[weight][tone]
  const closed = selected || active ? 'disabled:opacity-60' : 'disabled:border-dashed disabled:border-line disabled:bg-transparent disabled:text-muted disabled:font-normal'
  return (
    <button type='button'
      className={`rounded border whitespace-nowrap cursor-pointer transition-colors ${FOCUS} disabled:pointer-events-none ${closed}
        ${look} ${SIZE[size]} ${className}`}
      {...rest} />
  )
}

const KEY_LOOK = {
  plain: 'border-line from-raised to-surface text-fg hover:border-muted',
  picked: 'border-accent from-accent/25 to-accent/10 text-accent',
  go: 'border-accent from-accent to-accent text-bg font-semibold hover:brightness-110',
} as const

// A thing a character does in play, drawn as a key that sinks when pressed,
// set apart from the controls that edit and arrange. `cost` sits inside it in
// a chip; `go` is the press that moves play on, at most one to a panel. A
// closed key lies flat and dashed.
export function ActionKey({ cost, look = 'plain', className = '', children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { cost?: ReactNode, look?: keyof typeof KEY_LOOK }
){
  return (
    <button type='button'
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-linear-to-b px-2.5 py-1 text-xs font-medium cursor-pointer
        shadow-[0_2px_0_0_rgb(0_0_0/0.45),inset_0_1px_0_0_rgb(255_255_255/0.06)] transition-[transform,box-shadow,border-color] active:translate-y-[2px] active:shadow-none ${FOCUS}
        disabled:pointer-events-none disabled:bg-none disabled:border-dashed disabled:border-line disabled:shadow-none disabled:text-muted disabled:font-normal
        ${KEY_LOOK[look]} ${className}`}
      {...rest}>
      {children}
      {cost ? <span className='rounded px-1 py-px font-mono text-[10px] leading-none bg-current/15'>{cost}</span> : null}
    </button>
  )
}

const ICON_SIZE = {
  xs: { box: 'size-5', icon: 14 },
  sm: { box: 'size-6', icon: 16 },
} as const

const ICON_TONE: Record<Tone, string> = {
  neutral: 'text-muted hover:bg-raised hover:text-fg',
  accent: 'text-muted hover:bg-accent/15 hover:text-accent',
  good: 'text-muted hover:bg-good/15 hover:text-good',
  bad: 'text-muted hover:bg-bad/15 hover:text-bad',
}

// A control drawn as an icon alone, for what every screen does the same way:
// close, add, remove, zoom, turn. Its label is what the hover and a screen
// reader say, so it has to have one.
export function IconButton({ icon: Icon, tone = 'neutral', size = 'xs', active = false, selected = false, className = '', title, ...rest }:
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: LucideIcon, 'aria-label': string, tone?: Tone, size?: keyof typeof ICON_SIZE, active?: boolean, selected?: boolean }
){
  const look = selected ? 'bg-accent/15 text-accent' : active ? 'bg-raised text-fg' : ICON_TONE[tone]
  return (
    <button type='button' title={title ?? rest['aria-label']}
      className={`inline-grid shrink-0 place-items-center rounded cursor-pointer transition-colors ${FOCUS} disabled:opacity-40 disabled:pointer-events-none
        ${ICON_SIZE[size].box} ${look} ${className}`}
      {...rest}>
      <Icon size={ICON_SIZE[size].icon} aria-hidden />
    </button>
  )
}

// A value changed here from the template it came from: pressed, it takes the
// template's again.
export function ResetLink({ className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>){
  return (
    <button type='button'
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-xs text-accent bg-accent/10 hover:bg-accent/20 cursor-pointer ${FOCUS} ${className}`}
      {...rest}>
      <RotateCcw size={11} aria-hidden />{children}
    </button>
  )
}

// One selectable row in a list (sidebar catalogs, catalog editor entries).
export function ListButton({ selected = false, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }
){
  return (
    <button type='button'
      className={`text-left px-1 rounded text-sm cursor-pointer hover:bg-raised ${selected ? 'bg-raised text-accent' : ''} ${className}`}
      {...rest} />
  )
}

export const inputClass = 'bg-transparent border border-line rounded px-1 outline-none focus:border-accent disabled:opacity-40'
export const selectClass = `${inputClass} bg-surface text-xs py-0.5`
export const numberClass = `${inputClass} text-center font-mono [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0`

// While the field has focus it shows what was typed, so clearing it or typing
// past a leading zero is not overwritten by the committed value.
function useDraft(){
  const [draft, setDraft] = useState<string | null>(null)
  return {
    shown: (value: unknown) => draft ?? (value as string | number),
    type: (text: string) => setDraft(text),
    release: () => setDraft(null),
  }
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>){
  return <input type='text' className={`${inputClass} text-sm py-0.5 ${className}`} {...rest} />
}

export function NumberInput({ className = '', value, onChange, onBlur, ...rest }: InputHTMLAttributes<HTMLInputElement>){
  const draft = useDraft()
  return <input type='number' inputMode='numeric' className={`${numberClass} ${className}`} {...rest}
    value={draft.shown(value)}
    onChange={(e) => { draft.type(e.target.value); onChange?.(e) }}
    onBlur={(e) => { draft.release(); onBlur?.(e) }} />
}

// A text box with suggestions: every option shows while the box is focused,
// and only those matching what is typed once typing starts. Free text is kept.
export function Combobox({ value, options, onChange, className = '', ...rest }:
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string, options: string[], onChange: (value: string) => void }
){
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const query = value.toLowerCase()
  const shown = typed ? options.filter((o) => o.toLowerCase().includes(query)) : options
  return (
    <div ref={box} className='relative inline-block'>
      <input type='text' className={`${inputClass} text-sm py-0.5 ${className}`} {...rest} value={value}
        onFocus={() => { setOpen(true); setTyped(false) }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setTyped(true); onChange(e.target.value) }} />
      {open && shown.length > 0 ?
      <Floating anchor={box} gap={1} matchWidth role='listbox' className='max-h-60 rounded border border-line bg-raised py-0.5 shadow-lg shadow-black/40 text-xs'>
        {shown.map((o) => (
          <div key={o} role='option' aria-selected={o === value}
            className={`cursor-pointer px-2 py-0.5 hover:bg-accent/15 ${o === value ? 'text-accent' : 'text-fg'}`}
            onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false) }}>{o}</div>
        ))}
      </Floating>
      : null}
    </div>
  )
}

// A small uppercase heading over a group of tiles or rows.
export function SectionLabel({ children, className = '' }: { children: ReactNode, className?: string }){
  return <span className={`text-[10px] uppercase tracking-wider text-muted ${className}`}>{children}</span>
}

// A row of tabs with one open; the caller renders what the open one holds.
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T, label: string }[], value: T, onChange: (id: T) => void, label: string }){
  return (
    <div role='tablist' aria-label={label} className='flex flex-row gap-1 border-b border-line'>
      {tabs.map((t) => (
        <button key={t.id} type='button' role='tab' aria-selected={t.id === value} onClick={() => onChange(t.id)}
          className={`px-3 py-1 text-sm cursor-pointer border-b-2 -mb-px ${t.id === value ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'}`}>{t.label}</button>
      ))}
    </div>
  )
}

// A catalog browsed by category: the headers listed, one category open at a
// time and every one closed at start. A name typed in the filter narrows each
// category to its matches and opens all those left. A group with a null
// label is shown without a header, for a catalog with no categories. With a
// `collection`, a picker beside the filter narrows the list to one of the
// catalog's collections, each row known to it by `keyOf`.
export function CatalogList<T>({ label, groups, nameOf, render, beside, children, wide = false, collection }: {
  label: string, groups: { label: string | null, rows: T[] }[], nameOf: (row: T) => string, render: (row: T) => ReactNode,
  beside?: ReactNode, children?: ReactNode, wide?: boolean, collection?: { filter: CollectionFilter, keyOf: (row: T) => string },
}){
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const needle = filter.trim().toLowerCase()
  const narrowed = collection && !collection.filter.all ? collection : null
  const kept = (row: T) => (!narrowed || narrowed.filter.has(narrowed.keyOf(row))) && (!needle || nameOf(row).toLowerCase().includes(needle))
  const shown = needle || narrowed
    ? groups.map((g) => ({ ...g, rows: g.rows.filter(kept) })).filter((g) => g.rows.length)
    : groups
  return (
    <div className='flex flex-col w-full gap-1'>
      <div className='flex flex-row gap-1 items-center'>
        <TextInput className='w-full' placeholder='filter' aria-label={`${label} filter`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {collection ? <CollectionSelect label={`${label} collection`} filter={collection.filter} /> : null}
        {beside}
      </div>
      {children}
      {wide ? (
        <div className='columns-[18rem] gap-6'>
          {shown.map((g) => (
            <div key={g.label ?? ''} className='break-inside-avoid flex flex-col pb-3'>
              {g.label !== null ? <SectionLabel>{g.label || 'other'} · {g.rows.length}</SectionLabel> : null}
              {g.rows.map(render)}
            </div>
          ))}
        </div>
      ) :
      <div className='flex flex-col'>
        {shown.map((g) => {
          if (g.label === null) return <div key='' className='flex flex-col'>{g.rows.map(render)}</div>
          const name = g.label || 'other'
          const unfolded = needle !== '' || open === name
          return (
            <div key={name} className='flex flex-col'>
              <button type='button' aria-expanded={unfolded} aria-label={`${name} category`}
                className='text-left px-1 py-0.5 rounded cursor-pointer hover:bg-raised'
                onClick={() => setOpen(open === name ? null : name)}>
                <SectionLabel><span className='inline-block w-3'>{unfolded ? '▾' : '▸'}</span>{name} · {g.rows.length}</SectionLabel>
              </button>
              {unfolded ? <div className='ml-3 pl-1 border-l border-line flex flex-col pb-1'>{g.rows.map(render)}</div> : null}
            </div>
          )
        })}
      </div>}
    </div>
  )
}

// A titled card. `meta` sits after the title in muted text; `actions` are
// pushed to the right edge.
export function Panel({ title, meta, actions, children, className = '', pending = false }: {
  title: ReactNode, meta?: ReactNode, actions?: ReactNode, children?: ReactNode, className?: string, pending?: boolean
}){
  return (
    <div className={`flex flex-col gap-2 w-full rounded-md border bg-surface p-2 text-left ${pending ? 'border-good/60' : 'border-line'} ${className}`}>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-baseline'>
        <span className='font-medium'>{title}</span>
        {meta ? <span className='text-xs text-muted'>{meta}</span> : null}
        {actions ? <span className='ml-auto flex flex-row gap-1 items-center'>{actions}</span> : null}
      </div>
      {children}
    </div>
  )
}

// One bordered row inside a Panel (a held item, a container, a learned ability).
export function Row({ children, pending = false, dimmed = false, className = '' }: {
  children: ReactNode, pending?: boolean, dimmed?: boolean, className?: string
}){
  return (
    <div className={`flex flex-row flex-wrap gap-2 items-center rounded border px-1.5 py-1 text-xs
      ${pending ? 'border-good' : 'border-line'} ${dimmed ? 'text-muted' : ''} ${className}`}>
      {children}
    </div>
  )
}

// Counts the times `value` has changed since mount, except while the user is
// typing into `input` — a tile flashes when something *else* moved its value.
function useChangeCount(value: number | string, input: React.RefObject<HTMLInputElement | null>){
  const [count, setCount] = useState(0)
  const last = useRef(value)
  useEffect(() => {
    if (Object.is(last.current, value)) return
    last.current = value
    if (input.current && document.activeElement === input.current) return
    setCount((n) => n + 1)
  }, [value, input])
  return count
}

// A label over a value. Clickable tiles are buttons; editable ones carry an
// input; the rest are plain. `modifier` is the net change shown in the corner,
// `afflicted` paints the tile as harmed, and any change to `value` from
// outside the tile flashes its border once.
// `stepper` adds buttons that tick the value down and up by its step.
export function StatTile({ label, value, modifier = 0, afflicted = false, onClick, onChange, step, stepper = false, title, footer, className = '' }: {
  label: ReactNode
  value: number | string
  modifier?: number
  afflicted?: boolean
  onClick?: () => void
  onChange?: (value: number) => void
  step?: number
  stepper?: boolean
  title?: string
  footer?: ReactNode
  className?: string
}){
  const input = useRef<HTMLInputElement>(null)
  const changes = useChangeCount(value, input)
  const draft = useDraft()
  const frame = `relative flex flex-col gap-px w-16 min-w-0 rounded border bg-surface px-1 py-1 text-center
    ${afflicted ? 'border-bad' : 'border-line'} ${onClick ? 'cursor-pointer hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent' : ''} ${className}`
  const body = (
    <>
      <span className='text-[10px] leading-tight text-muted truncate' title={title ?? (typeof label === 'string' ? label : undefined)}>{label}</span>
      {
        onChange ?
        <div className='flex flex-row items-center'>
          {stepper ? <TickButton label={`lower ${title ?? String(label)}`} onClick={() => onChange(Number(value) - (step ?? 1))}>−</TickButton> : null}
          <input ref={input} type='number' inputMode='numeric' step={step} aria-label={title ?? String(label)} title={title ?? String(label)}
            className={`${numberClass} w-full min-w-0 text-sm py-0.5 ${stepper ? 'border-transparent' : ''} ${afflicted ? 'text-bad' : ''}`}
            value={draft.shown(value)} onBlur={draft.release} onChange={(e) => { draft.type(e.target.value); onChange((step && !Number.isInteger(step) ? parseFloat(e.target.value) : parseInt(e.target.value)) || 0) }} />
          {stepper ? <TickButton label={`raise ${title ?? String(label)}`} onClick={() => onChange(Number(value) + (step ?? 1))}>+</TickButton> : null}
        </div> :
        <span className={`font-mono font-medium text-base leading-tight ${afflicted ? 'text-bad' : ''}`}>{value}</span>
      }
      {modifier !== 0 ? <span className={`absolute top-0.5 right-1 font-mono text-[10px] ${modifier > 0 ? 'text-good' : 'text-bad'}`}>{modifier > 0 ? `+${modifier}` : modifier}</span> : null}
      {footer}
      {changes > 0 ? <span key={changes} aria-hidden className='absolute inset-0 rounded animate-flash motion-reduce:animate-none pointer-events-none' /> : null}
    </>
  )
  return onClick ?
    <button type='button' className={frame} onClick={onClick} aria-label={title ?? String(label)}>{body}</button> :
    <div className={frame}>{body}</div>
}

function TickButton({ label, onClick, children }: { label: string, onClick: () => void, children: ReactNode }){
  return <button type='button' aria-label={label} className='shrink-0 w-3.5 rounded text-xs leading-none text-muted hover:bg-raised hover:text-fg cursor-pointer' onClick={onClick}>{children}</button>
}

const FLOAT_EDGE = 8

type Placed = { left: number, top: number, maxHeight: number, minWidth?: number }

// A panel that floats beside an anchor, outside every container: it is drawn
// on the page itself, so no clipping or scrolling ancestor can cut it. It opens
// on `side` of the anchor, flips to the other when that has more room, slides
// sideways to stay inside the viewport, and scrolls within the room it has.
// Popover, Menu, Combobox and ProfileMenu all render through it.
export function Floating({ anchor, side = 'below', align = 'start', gap = 4, matchWidth = false, panelRef, className = '', style, children, ...rest }: {
  anchor: RefObject<HTMLElement | null>, side?: 'above' | 'below', align?: 'start' | 'center' | 'end', gap?: number, matchWidth?: boolean,
  panelRef?: RefObject<HTMLDivElement | null>,
} & HTMLAttributes<HTMLDivElement>){
  const own = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<Placed | null>(null)

  const place = () => {
    const a = anchor.current, el = own.current
    if (!a || !el) return
    const r = a.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.scrollHeight + el.offsetHeight - el.clientHeight
    const room = { above: r.top - FLOAT_EDGE - gap, below: window.innerHeight - r.bottom - FLOAT_EDGE - gap }
    const other = side === 'below' ? 'above' : 'below'
    const at = h <= room[side] || room[side] >= room[other] ? side : other
    const maxHeight = Math.max(room[at], 0)
    const left0 = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2
    const next: Placed = {
      left: Math.min(Math.max(left0, FLOAT_EDGE), Math.max(FLOAT_EDGE, window.innerWidth - FLOAT_EDGE - w)),
      top: at === 'below' ? r.bottom + gap : r.top - gap - Math.min(h, maxHeight),
      maxHeight,
      minWidth: matchWidth ? r.width : undefined,
    }
    setPlaced((p) => p && p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight && p.minWidth === next.minWidth ? p : next)
  }

  useLayoutEffect(place)
  useEffect(() => {
    const watch = own.current ? new ResizeObserver(place) : null
    if (own.current) watch?.observe(own.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { watch?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  })

  return createPortal(
    <div ref={(el) => { own.current = el; if (panelRef) panelRef.current = el }} {...rest}
      style={{ ...style, position: 'fixed', left: placed?.left ?? 0, top: placed?.top ?? 0, maxHeight: placed?.maxHeight, minWidth: placed?.minWidth,
        maxWidth: `calc(100vw - ${2 * FLOAT_EDGE}px)`, visibility: placed ? 'visible' : 'hidden' }}
      className={`z-50 w-max overflow-y-auto ${className}`}>
      {children}
    </div>,
    document.body,
  )
}

// A button that opens a panel of its own beneath it, closed by a click
// outside, by Escape, or by what the panel hands to `close`. With an `icon`
// it is drawn as that icon alone.
export function Dropdown({ label, text, icon, title, children }: { label: string, title?: string, children: (close: () => void) => ReactNode } & ({ text: ReactNode, icon?: never } | { icon: LucideIcon, text?: never })){
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const at = e.target as Node
      if (box.current && !box.current.contains(at) && !panel.current?.contains(at)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape) }
  }, [open])

  return (
    <div ref={box} className='relative'>
      {icon
        ? <IconButton icon={icon} active={open} title={title} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
        : <Button size='xs' active={open} title={title} aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{text}</Button>}
      {open ? (
        <Floating anchor={box} panelRef={panel} align='end' className='!w-60 flex flex-col gap-2 bg-raised border border-line rounded p-2 shadow-lg shadow-black/40 text-xs'>
          {children(() => setOpen(false))}
        </Floating>
      ) : null}
    </div>
  )
}

// A hover popover anchored to its child: opens centred above and drops below
// when there is no room above. SkillTooltip and Tooltip both render through it.
export function Popover({ content, children, className = '' }: { content: ReactNode, children: ReactNode, className?: string }){
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchor} className={`relative ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open ?
      <Floating anchor={anchor} side='above' align='center' role='tooltip'
        className='bg-raised border border-line rounded p-2 text-xs shadow-lg shadow-black/40 text-left font-normal text-fg'>
        {content}
      </Floating>
      : null}
    </div>
  )
}

// A plain text tooltip in the theme, in place of the browser's title bubble.
// Wraps in a span so it sits inline among buttons.
export function Tooltip({ text, children, className = '' }: { text: ReactNode, children: ReactNode, className?: string }){
  if (!text) return <>{children}</>
  return <Popover content={<span className='block max-w-64 whitespace-normal'>{text}</span>} className={`inline-flex ${className}`}>{children}</Popover>
}

// Why a closed button is closed, on hover. A disabled button takes no mouse
// events, so the hover lands on the wrapper and the button lets it through.
export function Closed({ reason, children }: { reason: string | null | undefined, children: ReactNode }){
  if (!reason) return <>{children}</>
  return <Tooltip text={reason} className='cursor-help [&>button]:pointer-events-none'>{children}</Tooltip>
}

// One count with its label, against its budget when it has one: green once
// spent in full, red when over.
export function BudgetChip({ label, spent, budget, over = false }: { label: string; spent: number | string; budget?: number | string; over?: boolean }) {
  const done = budget !== undefined && !over && spent === budget
  return (
    <div className={`flex flex-col items-center min-w-16 rounded border px-2 py-0.5 ${over ? 'border-bad text-bad' : done ? 'border-good text-good' : 'border-line'}`}>
      <span className='text-[10px] uppercase tracking-wider text-muted'>{label}</span>
      <span className='font-mono text-base font-semibold leading-tight'>{spent}{budget !== undefined ? <span className='font-normal text-muted'> / {budget}</span> : null}</span>
    </div>
  )
}

// The wrapping grid a set of tiles sits in.
export function Tiles({ children, className = '' }: { children: ReactNode, className?: string }){
  return <div className={`flex flex-row flex-wrap gap-1.5 ${className}`}>{children}</div>
}

// A delete that asks once more before it happens.
export function ConfirmDelete({ remove }: { remove: () => Promise<void> | void }){
  const [confirm, setConfirm] = useState(false)
  return confirm
    ? <>
        <Button weight='solid' tone='bad' onClick={async () => { await remove(); setConfirm(false) }}>confirm delete</Button>
        <Button weight='ghost' onClick={() => setConfirm(false)}>cancel</Button>
      </>
    : <Button tone='bad' onClick={() => setConfirm(true)}>delete</Button>
}

const MenuClose = createContext<() => void>(() => {})

// A "more" button that opens its options on a click, and closes on a click
// outside it, on Escape, or once an option is chosen. Clicks inside it stay
// inside, so a menu sits in a clickable frame without setting it off.
export function Menu({ label, children }: { label: string, children: ReactNode }){
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const at = e.target as Node
      if (box.current && !box.current.contains(at) && !panel.current?.contains(at)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape) }
  }, [open])

  return (
    <div ref={box} className='relative inline-flex' onClick={(e) => e.stopPropagation()}>
      <IconButton icon={Ellipsis} aria-label={label} aria-expanded={open} active={open} onClick={() => setOpen((o) => !o)} />
      {open ?
        <Floating anchor={box} panelRef={panel} role='menu' className='min-w-48 max-w-72 flex flex-col gap-0.5 bg-raised border border-line rounded p-1 shadow-lg shadow-black/40 text-xs text-left'>
          <MenuClose.Provider value={() => setOpen(false)}>{children}</MenuClose.Provider>
        </Floating>
        : null}
    </div>
  )
}

// One option of a menu, closing it once chosen unless it should `stay` open.
// One that cannot be chosen stays listed, with why under its label.
export function MenuItem({ bar = null, hint, selected = false, bad = false, stay = false, onClick, children }: {
  bar?: string | null, hint?: string, selected?: boolean, bad?: boolean, stay?: boolean, onClick: () => void, children: ReactNode,
}){
  const close = useContext(MenuClose)
  return (
    <button type='button' role='menuitem' disabled={bar !== null} title={hint}
      className={`text-left px-2 py-1 rounded cursor-pointer hover:bg-surface disabled:cursor-default disabled:hover:bg-transparent ${selected ? 'bg-accent/15' : ''}`}
      onClick={() => { onClick(); if (!stay) close() }}>
      <span className={`${bad ? 'text-bad' : selected ? 'text-accent' : 'text-fg'} ${bar ? 'opacity-40' : ''}`}>{children}</span>
      {bar ? <span className='block text-[10px] text-muted'>{bar}</span> : null}
    </button>
  )
}

// An option of a menu that throws something away: chosen, it asks again.
export function MenuConfirm({ bar = null, hint, onConfirm, children }: { bar?: string | null, hint?: string, onConfirm: () => void, children: ReactNode }){
  const close = useContext(MenuClose)
  const [asking, setAsking] = useState(false)
  if (!asking) return <MenuItem bad stay bar={bar} hint={hint} onClick={() => setAsking(true)}>{children}</MenuItem>
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center px-2 py-1'>
      <Button size='xs' weight='solid' tone='bad' onClick={() => { onConfirm(); close() }}>confirm</Button>
      <Button size='xs' weight='ghost' onClick={() => setAsking(false)}>cancel</Button>
    </div>
  )
}

// A control in a menu that is more than one press (a picker, a switch),
// under its label.
export function MenuSection({ label, children }: { label: string, children: ReactNode }){
  return (
    <div className='flex flex-col gap-1 px-2 py-1 mt-0.5 border-t border-line'>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  )
}

// Which collection of a catalog a picker shows.
export function CollectionSelect({ filter: { collections, chosen, choose }, label }: { filter: CollectionFilter, label: string }){
  return (
    <select aria-label={label} className={selectClass} value={chosen} onChange={(e) => choose(e.target.value)}>
      {collections.map((c) => <option key={c.id} value={c.id}>{c.name || '—'}{c.curated ? '' : ' (catalog)'}</option>)}
    </select>
  )
}

// A control's props while `bar` says why it cannot be used: closed, with why
// as its hint.
export function barred(bar: string | null): { disabled: boolean; title: string | undefined } {
  return { disabled: bar !== null, title: bar ?? undefined }
}
