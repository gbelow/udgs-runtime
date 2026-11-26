'use client'
import { useEffect, useRef, useState } from 'react'
import type { BoardCellView, BoardView } from '../domain/scene/projections/boardView'
import type { Coord } from '../domain/scene/types'
import { useCameraAsked, usePlaybackReport, type BoardCamera } from '../hooks/useBoardCanvas'
import type { BoardHover, BoardStage } from '../board/stage'
import type { BoardMotion } from '../board/playback'

type Props = {
  view: BoardView
  veiled: readonly string[]
  picked?: readonly string[]
  label: string
  className?: string
  camera: BoardCamera
  cellAt: (view: BoardView, point: { x: number; y: number }) => BoardCellView | null
  onCell: (cell: Coord) => void
  onToken?: (id: string) => void
  onFloorItem?: (itemId: string) => void
  // the cell the pointer is on, told so that what is drawn over it is veiled
  setLit?: (key: string | null) => void
  // what the space bar does while the board has the focus, which it takes
  // under the pointer unless something is being written
  onSpace?: () => void
  // how fast what happens on the board plays, or not at all
  motion?: BoardMotion
}

const NONE: readonly string[] = []

// The board drawn on a canvas (app/board), with what the pointer rests on said
// in words beside it. Pixi is loaded only in the browser.
export function BoardCanvas(props: Props){
  const { view, veiled, picked = NONE, label, className, onSpace, motion = 'normal' } = props
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<BoardStage | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [hover, setHover] = useState<BoardHover | null>(null)
  const report = usePlaybackReport()
  const asked = useCameraAsked()

  useEffect(() => {
    let alive = true
    let made: BoardStage | null = null
    const { onToken, onFloorItem } = latest.current
    void import('../board/stage').then(({ BoardStage }) => {
      if (!alive || !host.current) return
      made = new BoardStage(host.current, {
        cellAt: (v, p) => latest.current.cellAt(v, p),
        onCell: (cell) => latest.current.onCell(cell),
        onToken: onToken ? (id) => latest.current.onToken?.(id) : undefined,
        onFloorItem: onFloorItem ? (id) => latest.current.onFloorItem?.(id) : undefined,
        onHover: (h) => { setHover(h); latest.current.setLit?.(h?.kind === 'cell' ? h.key : null) },
        onZoomed: (z) => latest.current.camera.setZoomed(z),
        onPlaying: report,
      })
      stage.current = made
      latest.current.camera.attach(made)
      made.setMotion(latest.current.motion ?? 'normal')
      made.set({ view: latest.current.view, veiled: latest.current.veiled, picked: latest.current.picked ?? NONE })
    })
    return () => {
      alive = false
      made?.dispose()
      stage.current = null
      latest.current.camera.attach(null)
    }
  }, [report])

  useEffect(() => { stage.current?.set({ view, veiled, picked }) }, [view, veiled, picked])
  useEffect(() => { stage.current?.setMotion(motion) }, [motion])
  useEffect(() => { if (asked) stage.current?.lookAt(asked.id) }, [asked])

  const title = hover ? titleOf(view, hover) : null
  return (
    <div className={`relative overflow-hidden select-none ${className ?? ''}`}>
      <div ref={host} className='absolute inset-0 outline-none' role='img' aria-label={label}
        tabIndex={onSpace ? 0 : undefined}
        onPointerDown={() => focusBoard(host.current)}
        onPointerEnter={() => { if (!isWriting()) focusBoard(host.current) }}
        onPointerMove={() => { if (document.activeElement === document.body) focusBoard(host.current) }}
        onKeyDown={(e) => {
          if (!onSpace || e.code !== 'Space') return
          e.preventDefault()
          if (!e.repeat) onSpace()
        }} />
      {title ?
        <div className='pointer-events-none absolute z-10 max-w-xs rounded border border-line bg-raised px-2 py-1 text-xs text-fg shadow'
          style={{ left: hover!.x + 14, top: hover!.y + 14 }}>{title}</div>
        : null}
    </div>
  )
}

const focusBoard = (host: HTMLElement | null) => { if (host?.hasAttribute('tabindex')) host.focus({ preventScroll: true }) }

// Whether a field being written in has the focus.
const isWriting = () => {
  const at = document.activeElement
  return at instanceof HTMLElement && (at.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(at.tagName))
}

function titleOf(view: BoardView, hover: BoardHover): string | null {
  if (hover.kind === 'cell') {
    const cell = view.cells.find((c) => c.key === hover.key)
    return cell ? cellTitle(cell) : null
  }
  if (hover.kind === 'token') {
    const t = view.tokens.find((x) => x.id === hover.id)
    return t ? `${t.name}${t.elsewhere ? ' · on another floor' : ''}${t.heard ? ' · heard, out of sight' : ''}${t.hidden ? ' · behind higher ground' : ''}${t.awaited ? ' · may react: waiting on their answer' : ''}${t.elevation ? ` · ${t.elevation} m` : ''}${t.depth ? ` · ${t.depth} m deep` : ''}${t.shieldAngle !== null ? ' · in cover behind a body shield' : ''}${t.hanging ? ` · hanging on the face to ${t.hanging.to}, ${t.hanging.covered} of ${t.hanging.height} m` : ''}` : null
  }
  const item = view.floor.find((f) => f.itemId === hover.itemId)
  return item ? (item.targetable ? `aim at ${item.name}` : item.pickable ? `pick up ${item.name}` : `on the floor: ${item.name}`) : null
}

const TERRAIN_LABEL = {
  open: null,
  wall: 'wall',
  glass: 'glass',
  water: 'water',
  rough: 'rough',
} as const

// What the cell says of itself when the pointer rests on it.
function cellTitle(cell: BoardCellView): string {
  return [
    cell.key,
    cell.unseen ? 'out of sight' : null,
    cell.piece !== null ? (cell.chosen ? 'the piece picked' : 'part of a piece') : null,
    cell.storey === 'roof' ? 'a roof over what is out of their sight' : cell.storey === 'air' ? 'open air over the ground' : cell.storey === 'hole' ? 'stairwell over the ground' : cell.storey === 'lattice' ? 'lattice: seen, shot and climbed through' : null,
    TERRAIN_LABEL[cell.terrain],
    cell.surface,
    cell.strength,
    cell.elevation ? `${cell.elevation} m` : null,
    cell.climbDL !== null ? `climbing up here: DL ${cell.climbDL}` : null,
    cell.test ? `${cell.test.kind} DL ${cell.test.DL}` : null,
    cell.soft ? 'soft ground' : null,
    cell.fire > 0 ? `fire ${cell.fire}` : null,
    cell.fuels.length > 0 ? `coated in ${cell.fuels.join(' and ')}` : null,
    cell.suffocating ? 'suffocating gas' : null,
    cell.visibility === 'zero' ? 'no visibility' : cell.visibility === 'bad' ? 'bad visibility' : null,
    cell.light === 'dark' ? 'dark' : cell.light === 'dim' ? 'dim light' : cell.lit ? 'lit' : null,
    cell.noise > 0 ? `noise ${cell.noise}` : null,
    cell.reachable ? `${cell.reachable.steps} cells · ${cell.reachable.cost.AP} AP${cell.reachable.cost.STA ? ` ${cell.reachable.cost.STA} STA` : ''}` : null,
    cell.swept ? 'on the way of the move' : null,
    cell.jump ? 'evasive jump' : null,
    cell.center ? 'aim here' : null,
    cell.zone ? `explosion: ${cell.zone}` : cell.threatened ? 'in reach of the explosion' : null,
    cell.items.length > 0 ? `on the floor: ${cell.items.join(', ')}` : null,
  ].filter((s) => s !== null).join(' · ')
}
