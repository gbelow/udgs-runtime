'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton } from './ui'
import { useMapEditing } from '../hooks/useMap'
import type { Point } from '../domain/campaign/rules/layout'
import type { MapGraphView } from '../domain/campaign/projections/map'

export type MapSelection = { kind: 'node' | 'connection'; id: string } | null

type Drag =
  | { kind: 'move'; id: string; x: number; y: number; moved: boolean }
  | { kind: 'link'; from: string; x: number; y: number }
  | { kind: 'pan'; clientX: number; clientY: number; from: Box }

type Box = { x: number; y: number; w: number; h: number }

// What the drawing lets its user change: nodes added and moved, paths drawn
// from the picked node's handle, and, while `connecting`, a click on another
// node joining it to the picked one.
type DrawingEdit = {
  addNode: (at?: Point) => void
  moveNode: (id: string, to: Point) => void
  connect: (a: string, b: string) => void
  connecting: boolean
  stopConnecting: () => void
}

const NODE_R = 26
const HANDLE_R = 7
const ZOOM_STEP = 1.2
const MIN_ZOOM = 0.25
const MAX_ZOOM = 8

// survival.tex "Creating the point crawl": the map being made, drawn with
// the tools to make it beside the zoom.
export function MapCanvas({ selected, select }: { selected: MapSelection, select: (s: MapSelection) => void }) {
  const { view, addNode, moveNode, addConnection } = useMapEditing()
  const [connecting, setConnecting] = useState(false)
  const edit: DrawingEdit = { addNode, moveNode, connect: (a, b) => addConnection(a, b, 0, 0), connecting, stopConnecting: () => setConnecting(false) }
  return (
    <MapDrawing graph={view.graph} selected={selected} select={select} edit={edit}
      hint='double-click to add a node there · drag a node to move it · drag its handle onto another node to join them · wheel to zoom · drag the ground to pan'
      tools={<>
        <Button size='xs' weight='subtle' onClick={() => addNode()}>+ node</Button>
        <Button size='xs' weight='subtle' selected={connecting} disabled={selected?.kind !== 'node'} onClick={() => setConnecting(!connecting)}>
          {connecting ? 'click the other node…' : 'connect'}
        </Button>
      </>} />
  )
}

// survival.tex "Point crawl": the map drawn as nodes joined by paths. A click
// picks a node or a path, the paths in `marked` drawn out; the wheel zooms
// where the pointer is, and dragging the empty ground pans. With `edit`, the
// map is changed on it too.
export function MapDrawing({ graph, selected, select, marked = [], edit, tools, hint }: {
  graph: MapGraphView
  selected: MapSelection
  select: (s: MapSelection) => void
  marked?: string[]
  edit?: DrawingEdit
  tools?: ReactNode
  hint: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, show] = useState<Drag | null>(null)
  // read by the pointer handlers, which can fire again before a render
  const current = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => { current.current = d; show(d) }
  const fit: Box = { x: 0, y: 0, w: graph.width, h: graph.height }
  const [box, setBox] = useState<Box>(fit)

  const at = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: box.x + ((e.clientX - r.left) / r.width) * box.w, y: box.y + ((e.clientY - r.top) / r.height) * box.h }
  }

  // zooms by `factor` keeping the point under (clientX, clientY) in place;
  // without a point, about the middle of what is shown
  const zoom = (factor: number, e?: { clientX: number; clientY: number }) => setBox((b) => {
    const w = Math.min(graph.width / MIN_ZOOM, Math.max(graph.width / MAX_ZOOM, b.w / factor))
    const h = (w / b.w) * b.h
    const r = svg.current!.getBoundingClientRect()
    const fx = e ? (e.clientX - r.left) / r.width : 0.5, fy = e ? (e.clientY - r.top) / r.height : 0.5
    return { x: b.x + fx * (b.w - w), y: b.y + fy * (b.h - h), w, h }
  })
  const zoomAt = useRef(zoom)
  zoomAt.current = zoom
  // React's wheel listener is passive, so the page would scroll as well
  useEffect(() => {
    const el = svg.current!
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt.current(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e) }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const nodeUnder = (e: { clientX: number; clientY: number }) =>
    document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>('[data-node]')?.dataset.node ?? null
  const drawn = (id: string) => (drag?.kind === 'move' && drag.id === id ? drag : graph.nodes.find((n) => n.id === id))

  const pickNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (edit?.connecting && selected?.kind === 'node' && selected.id !== id) {
      edit.connect(selected.id, id)
      edit.stopConnecting()
    }
    select({ kind: 'node', id })
    if (!edit) return
    const n = graph.nodes.find((n) => n.id === id)!
    svg.current!.setPointerCapture(e.pointerId)
    setDrag({ kind: 'move', id, x: n.x, y: n.y, moved: false })
  }

  const startLink = (e: React.PointerEvent, from: string) => {
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    setDrag({ kind: 'link', from, ...at(e) })
  }

  const onMove = (e: React.PointerEvent) => {
    const d = current.current
    if (!d) return
    if (d.kind === 'pan') {
      const r = svg.current!.getBoundingClientRect()
      setBox({ ...d.from, x: d.from.x - ((e.clientX - d.clientX) / r.width) * d.from.w, y: d.from.y - ((e.clientY - d.clientY) / r.height) * d.from.h })
      return
    }
    setDrag(d.kind === 'move' ? { ...d, ...at(e), moved: true } : { ...d, ...at(e) })
  }

  const startPan = (e: React.PointerEvent) => {
    select(null)
    edit?.stopConnecting()
    svg.current!.setPointerCapture(e.pointerId)
    setDrag({ kind: 'pan', clientX: e.clientX, clientY: e.clientY, from: box })
  }

  const onUp = (e: React.PointerEvent) => {
    const d = current.current
    if (!d) return
    if (d.kind === 'move' && d.moved) edit?.moveNode(d.id, { x: d.x, y: d.y })
    if (d.kind === 'link') {
      const to = nodeUnder(e)
      if (to && to !== d.from) edit?.connect(d.from, to)
    }
    setDrag(null)
  }

  const source = drag?.kind === 'link' ? drawn(drag.from) : null

  return (
    <div className='flex flex-col gap-1 min-w-0 grow'>
      <div className='flex flex-row items-center gap-2'>
        {tools}
        <IconButton icon={ZoomIn} aria-label='zoom in' title='zoom in (or the wheel)' onClick={() => zoom(ZOOM_STEP)} />
        <IconButton icon={ZoomOut} aria-label='zoom out' title='zoom out (or the wheel)' onClick={() => zoom(1 / ZOOM_STEP)} />
        <IconButton icon={Scan} aria-label='fit map' title='show the whole map' onClick={() => setBox(fit)} />
        <span className='text-xs text-muted'>{hint}</span>
      </div>
      <svg ref={svg} role='img' aria-label='point crawl map' viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className='w-full rounded border border-line bg-surface touch-none select-none'
        onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
        onPointerDown={startPan}
        onDoubleClick={edit ? (e) => edit.addNode(at(e)) : undefined}>
        {graph.edges.map((c) => {
          const a = drawn(c.a) ?? { x: c.ax, y: c.ay }, b = drawn(c.b) ?? { x: c.bx, y: c.by }
          const isSel = selected?.kind === 'connection' && selected.id === c.id
          const isMarked = marked.includes(c.id)
          const moving = drag?.kind === 'move' && drag.moved && (drag.id === c.a || drag.id === c.b)
          return (
            <g key={c.id} className='cursor-pointer' onPointerDown={(e) => { e.stopPropagation(); select({ kind: 'connection', id: c.id }); edit?.stopConnecting() }} onDoubleClick={(e) => e.stopPropagation()}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={26} className='stroke-transparent' />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={isSel ? 4 : 2} strokeDasharray={isMarked ? '8 5' : undefined}
                className={isSel ? 'stroke-accent' : isMarked ? 'stroke-good' : 'stroke-muted'} pointerEvents='none' />
              {moving ? null :
                <text x={c.mx} y={c.my - 8} textAnchor='middle' className={`text-[13px] font-mono pointer-events-none ${isSel ? 'fill-accent' : 'fill-muted'}`}>
                  {c.DL} / {c.backDL}{c.events ? ` ◆${c.events}` : ''}
                </text>}
            </g>
          )
        })}
        {source && drag?.kind === 'link' ?
          <line x1={source.x} y1={source.y} x2={drag.x} y2={drag.y} className='stroke-accent' strokeWidth={2} strokeDasharray='6 4' pointerEvents='none' />
          : null}
        {graph.nodes.map((n) => {
          const p = drawn(n.id) ?? n
          const isSel = selected?.kind === 'node' && selected.id === n.id
          return (
            <g key={n.id} data-node={n.id} className={edit ? 'cursor-grab' : 'cursor-pointer'} onPointerDown={(e) => pickNode(e, n.id)} onDoubleClick={(e) => e.stopPropagation()}>
              {n.settlement ?
                <rect x={p.x - NODE_R} y={p.y - NODE_R} width={NODE_R * 2} height={NODE_R * 2} rx={8} strokeWidth={isSel ? 3 : 2} className={`fill-raised ${isSel ? 'stroke-accent' : n.parties.length ? 'stroke-good' : 'stroke-line'}`} />
                : <circle cx={p.x} cy={p.y} r={NODE_R} strokeWidth={isSel ? 3 : 2} className={`fill-raised ${isSel ? 'stroke-accent' : n.parties.length ? 'stroke-good' : 'stroke-line'}`} />}
              <text x={p.x} y={p.y + 4} textAnchor='middle' className='text-[12px] fill-fg pointer-events-none'>{n.events ? `◆${n.events}` : ''}</text>
              <text x={p.x} y={p.y + NODE_R + 16} textAnchor='middle' className='text-[14px] fill-fg pointer-events-none'>{n.name}</text>
              {n.terrain ? <text x={p.x} y={p.y + NODE_R + 30} textAnchor='middle' className='text-[11px] fill-muted pointer-events-none'>{n.terrain}</text> : null}
              {n.parties.length ? <text x={p.x} y={p.y - NODE_R - 8} textAnchor='middle' className='text-[12px] fill-good pointer-events-none'>{n.parties.join(', ')}</text> : null}
              {isSel && edit ?
                <circle cx={p.x + NODE_R} cy={p.y - NODE_R} r={HANDLE_R} className='fill-accent cursor-crosshair' onPointerDown={(e) => startLink(e, n.id)}>
                  <title>drag onto another node to join them</title>
                </circle>
                : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
