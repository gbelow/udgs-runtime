'use client'
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

// The shared visual vocabulary. Colour is by meaning (see globals.css): accent
// selects, good is the pending flow, bad is harm, muted is derived or
// unavailable. Nothing here knows anything about the game.

export type ButtonVariant = 'default' | 'primary' | 'good' | 'bad' | 'ghost'

const VARIANT: Record<ButtonVariant, string> = {
  default: 'border-line bg-surface text-fg hover:bg-raised hover:border-muted',
  primary: 'border-accent bg-surface text-accent hover:bg-accent/15',
  good: 'border-good bg-surface text-good hover:bg-good/15',
  bad: 'border-bad bg-surface text-bad hover:bg-bad/15',
  ghost: 'border-transparent bg-transparent text-muted hover:text-fg',
}

const SIZE = {
  xs: 'text-xs px-1.5 py-px',
  sm: 'text-xs px-2.5 py-1',
  md: 'text-sm px-3 py-1',
} as const

export function Button({ variant = 'default', size = 'sm', active = false, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant, size?: keyof typeof SIZE, active?: boolean }
){
  return (
    <button type='button'
      className={`rounded border whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:pointer-events-none disabled:hover:bg-surface
        focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1
        ${VARIANT[variant]} ${SIZE[size]} ${active ? 'bg-raised' : ''} ${className}`}
      {...rest} />
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
export const numberClass = `${inputClass} text-center font-mono appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>){
  return <input type='text' className={`${inputClass} text-sm py-0.5 ${className}`} {...rest} />
}

export function NumberInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>){
  return <input type='number' inputMode='numeric' className={`${numberClass} ${className}`} {...rest} />
}

// A small uppercase heading over a group of tiles or rows.
export function SectionLabel({ children, className = '' }: { children: ReactNode, className?: string }){
  return <span className={`text-[10px] uppercase tracking-wider text-muted ${className}`}>{children}</span>
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
export function StatTile({ label, value, modifier = 0, afflicted = false, onClick, onChange, step, title, footer, className = '' }: {
  label: ReactNode
  value: number | string
  modifier?: number
  afflicted?: boolean
  onClick?: () => void
  onChange?: (value: number) => void
  step?: number
  title?: string
  footer?: ReactNode
  className?: string
}){
  const input = useRef<HTMLInputElement>(null)
  const changes = useChangeCount(value, input)
  const frame = `relative flex flex-col gap-px w-16 min-w-0 rounded border bg-surface px-1 py-1 text-center
    ${afflicted ? 'border-bad' : 'border-line'} ${onClick ? 'cursor-pointer hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent' : ''} ${className}`
  const body = (
    <>
      <span className='text-[10px] leading-tight text-muted truncate' title={title ?? (typeof label === 'string' ? label : undefined)}>{label}</span>
      {
        onChange ?
        <input ref={input} type='number' inputMode='numeric' step={step} aria-label={title ?? String(label)} title={title ?? String(label)}
          className={`${numberClass} w-full text-sm py-0.5 ${afflicted ? 'text-bad' : ''}`}
          value={value} onChange={(e) => onChange(step && !Number.isInteger(step) ? parseFloat(e.target.value) : parseInt(e.target.value))} /> :
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

const POPOVER_EDGE = 8

// A hover popover anchored to its child: opens centred above, slides sideways
// just enough to stay inside the viewport, drops below when there is no room
// above. SkillTooltip and Tooltip both render through it.
export function Popover({ content, children, className = '' }: { content: ReactNode, children: ReactNode, className?: string }){
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState({ x: 0, below: false })
  const tip = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !tip.current) return
    const r = tip.current.getBoundingClientRect()
    const x = r.left < POPOVER_EDGE ? POPOVER_EDGE - r.left : r.right > window.innerWidth - POPOVER_EDGE ? window.innerWidth - POPOVER_EDGE - r.right : 0
    setShift({ x, below: r.top < POPOVER_EDGE })
  }, [open])

  return (
    <div className={`relative ${className}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => { setOpen(false); setShift({ x: 0, below: false }) }}>
      {children}
      {open ?
      <div ref={tip} role='tooltip'
        style={{ transform: `translateX(calc(-50% + ${shift.x}px))` }}
        className={`absolute z-50 left-1/2 w-max ${shift.below ? 'top-full mt-1' : 'bottom-full mb-1'}
                    bg-raised border border-line rounded p-2 text-xs shadow-lg shadow-black/40 text-left font-normal text-fg`}>
        {content}
      </div>
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

// The wrapping grid a set of tiles sits in.
export function Tiles({ children, className = '' }: { children: ReactNode, className?: string }){
  return <div className={`flex flex-row flex-wrap gap-1.5 ${className}`}>{children}</div>
}
