'use client'
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PanelRight, X } from 'lucide-react'
import { useDockSize, type DockSide } from '../hooks/useDockSize'
import { useSheetWindow } from '../hooks/useSheetWindow'
import { Button, IconButton, SectionLabel } from './ui'

// Follows the pointer from a press until it is let go.
function follow(e: ReactPointerEvent, move: (m: PointerEvent) => void) {
  if (e.button !== 0) return
  e.preventDefault()
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// A bottom corner of the screen, over everything under it, what it holds
// stacked up from the bottom. Only what it holds takes clicks.
export function ScreenCorner({ side, children }: { side: DockSide, children: ReactNode }){
  return(
    <div className={`fixed z-20 top-24 bottom-2 ${side === 'left' ? 'left-2 items-start' : 'right-2 items-end'} flex flex-col justify-end gap-2 pointer-events-none`}>
      {children}
    </div>
  )
}

// A box in a bottom corner: as big as what it holds until it is resized, by
// dragging its top edge or the edge that faces the middle; the browser keeps
// the size it was given.
export function DockBox({ side, children }: { side: DockSide, children: ReactNode }){
  const { width, height, set } = useDockSize(side)
  const box = useRef<HTMLDivElement>(null)
  const dragTop = (e: ReactPointerEvent) => follow(e, (m) => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) set({ height: rect.bottom - m.clientY })
  })
  const dragSide = (e: ReactPointerEvent) => follow(e, (m) => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) set({ width: side === 'left' ? m.clientX - rect.left : rect.right - m.clientX })
  })
  const size = { ...(width === null ? {} : { '--dock-w': `${width}px` }), ...(height === null ? {} : { '--dock-h': `${height}px` }) } as CSSProperties
  return(
    <div ref={box} style={size}
      className={`pointer-events-auto relative shrink-0 flex flex-col min-h-0 rounded border border-line bg-bg/90 shadow-lg shadow-black/40 backdrop-blur-sm max-w-[45vw] ${width === null ? 'w-max min-w-52' : 'w-[var(--dock-w)]'} ${height === null ? 'max-h-[40vh]' : 'h-[var(--dock-h)] max-h-[calc(100vh-8rem)]'}`}>
      <div className='flex-1 min-h-0 p-2 flex flex-col gap-1 overflow-y-auto text-xs'>{children}</div>
      <div role='separator' aria-orientation='horizontal' aria-label={`drag to resize the ${side} box`} title='drag to resize'
        className='absolute -top-1 inset-x-0 h-2 cursor-row-resize hover:bg-accent/40 rounded' onPointerDown={dragTop} />
      <div role='separator' aria-orientation='vertical' aria-label={`drag to widen the ${side} box`} title='drag to resize'
        className={`absolute top-0 bottom-0 w-2 cursor-col-resize hover:bg-accent/40 rounded ${side === 'left' ? '-right-1' : '-left-1'}`} onPointerDown={dragSide} />
    </div>
  )
}

// Opens or closes the sheet's window.
export function SheetToggle(){
  const { open, setOpen } = useSheetWindow()
  return <Button size='xs' selected={open} aria-label={open ? 'close the sheet' : 'open the sheet'} className='self-start' onClick={() => setOpen(!open)}>sheet</Button>
}

// The sheet as a window over the scene: closed until opened, docked on the
// right over the log, or wherever its title bar was dragged to, until it is
// docked again. Placed in the right corner, above the log.
export function SheetWindow({ title, children }: { title: string, children: ReactNode }){
  const { open, at, setOpen, setAt } = useSheetWindow()
  const box = useRef<HTMLDivElement>(null)
  if (!open) return null
  const drag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const grip = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    follow(e, (m) => setAt({ x: m.clientX - grip.x, y: m.clientY - grip.y }))
  }
  return(
    <div ref={box} role='dialog' aria-label='sheet' style={at ? { left: at.x, top: at.y } : undefined}
      className={`pointer-events-auto w-[32rem] max-w-[calc(100vw-1rem)] flex flex-col rounded border border-line bg-bg/95 shadow-lg shadow-black/40 ${at ? 'fixed z-30 max-h-[calc(100vh-4rem)]' : 'min-h-0 shrink'}`}>
      <div onPointerDown={drag} className='flex flex-row items-center gap-2 px-2 py-1 border-b border-line cursor-move select-none'>
        <SectionLabel>{title}</SectionLabel>
        <span className='grow' />
        {at ? <IconButton icon={PanelRight} aria-label='dock the sheet' title='dock it on the right, over the log' onClick={() => setAt(null)} /> : null}
        <IconButton icon={X} aria-label='close the sheet' onClick={() => setOpen(false)} />
      </div>
      <div className='min-h-0 overflow-y-auto p-2'>{children}</div>
    </div>
  )
}
