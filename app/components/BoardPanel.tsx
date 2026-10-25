'use client'
import { memo, useState, type MouseEvent } from 'react'
import { useBoard } from '../hooks/useBoard'
import { useVttLink } from '../hooks/useVttLink'
import { useBoardMaps } from '../hooks/useBoardMaps'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import { useZoomPan } from '../hooks/useZoomPan'
import type { Coord } from '../domain/scene/types'
import type { BoardCellView, BoardFloorItemView, BoardGhostView, BoardBindView, BoardTokenView } from '../domain/scene/projections/boardView'
import type { TerrainBrush } from '../domain/types'
import { LIGHT_LEVELS, TERRAIN_BRUSHES } from '../domain/lists'
import { RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton, Panel, SectionLabel, Segment, Segmented, TextInput, Tooltip, selectClass } from './ui'
import { SceneCards } from './SceneCards'

const MODE_LABEL = {
  idle: 'click a cell to place the active character (to move them again only until the fight starts), or an item to pick it up',
  path: 'click cells to walk the move',
  jump: 'click a cell to jump there',
  aim: 'click a cell to aim',
  locked: 'an action is open',
} as const

export const BRUSH_LABEL: Record<TerrainBrush, string> = {
  wall: 'wall',
  glass: 'glass',
  sturdier: 'RES +5',
  flimsier: 'RES −5',
  water: 'water',
  rough: 'rough',
  soft: 'soft',
  raise: '+1 m',
  lower: '−1 m',
  deepen: 'deeper',
  shoal: 'shallower',
  harder: 'DL +1',
  easier: 'DL −1',
  grip: 'grip +1',
  slip: 'grip −1',
  bare: 'no grip',
  dim: 'dim',
  fog: 'fog',
  dark: 'dark',
  louder: 'noise +1',
  quieter: 'noise −1',
  clear: 'clear',
}

// The simulated grid: a hex field the GM paints, lights and repositions
// characters on, each placed by hand the first time, and the surface a move
// is walked on, zoomed with the wheel and panned by dragging. Everything drawn is a field of the board view; the panel
// only translates it into shapes.
export function BoardPanel(){
  const [fromActive, setFromActive] = useState(false)
  const { view, create, remove, clickCell, clickToken, clickFloorItem, place, turn, light } = useBoard(fromActive)
  const [brush, setBrush] = useState<TerrainBrush | null>(null)
  const [reposition, setReposition] = useState(false)
  const [tools, setTools] = useState(false)
  const { gmTools } = useRole()
  const gmBar = useGmBar()
  const open = tools && gmTools
  const zoomPan = useZoomPan(view.viewBox)

  if (!view.present) {
    return (
      <Panel meta='no grid: everyone is in reach'
        title={<span className='inline-flex items-center gap-2'>Board <Button size='xs' tone='accent' aria-label='new board' disabled={gmBar !== null} title={gmBar ?? 'draw a hex grid for the scene'} onClick={() => create(6)}>simulate a grid</Button></span>}>
        {gmTools ? <MapsRow canSave={false} /> : null}
        <SceneCards />
      </Panel>
    )
  }

  const painting = open && brush !== null
  const repositioning = open && reposition
  return (
    <Panel title='Board' meta={painting ? `painting ${BRUSH_LABEL[brush]}` : repositioning ? 'click a cell to put the active character there, turn to turn them' : MODE_LABEL[view.mode]} pending={view.mode === 'path' || view.mode === 'jump' || view.mode === 'aim'}
      className='h-full'
      actions={<>
        <ZoomButtons zoomPan={zoomPan} />
        <Button size='xs' selected={fromActive} aria-label='see as the active character' title='draw only what the active character can see' onClick={() => setFromActive(!fromActive)}>their eyes</Button>
        {gmTools ? <Button size='xs' selected={tools} aria-label='board tools' onClick={() => { setTools(!tools); setBrush(null); setReposition(false) }}>GM board tools</Button> : null}
        <IconButton icon={RotateCw} aria-label='turn' title={repositioning ? 'turn the active character clockwise' : 'turn the move clockwise, or the active character until the fight starts'} onClick={() => turn(repositioning)} />
        <Button size='xs' weight='subtle' tone='bad' aria-label='remove board' disabled={gmBar !== null || view.mode !== 'idle'} title={gmBar ?? (view.mode !== 'idle' ? 'an action is open' : 'take the grid away: everyone is in reach')} onClick={remove}>no grid</Button>
      </>}>

      {open ? (<>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>place</SectionLabel>
        <Button size='xs' aria-label='reposition' selected={reposition} title='put the active character anywhere, placed before or not, and turn them'
          onClick={() => { setReposition(!reposition); setBrush(null) }}>reposition</Button>
      </div>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>paint</SectionLabel>
        <Button size='xs' selected={brush === null}
          onClick={() => setBrush(null)}>control</Button>
        {TERRAIN_BRUSHES.map((b) =>
          <Button key={b} size='xs' selected={brush === b}
            onClick={() => { setBrush(brush === b ? null : b); setReposition(false) }}>{BRUSH_LABEL[b]}</Button>)}
      </div>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>light</SectionLabel>
        <Segmented label='light'>
          {LIGHT_LEVELS.map((l) =>
            <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
        </Segmented>
      </div>
      <MapsRow canSave />
      <LinkRow />
      {gmTools ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>GM</SectionLabel>
          <Tooltip text='put an item from the catalog on the clicked cell — not built yet'>
            <Button size='xs' aria-label='gm item to ground' disabled>item to ground</Button>
          </Tooltip>
        </div>
      ) : null}
      </>) : null}

      {view.unplaced.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>unplaced</SectionLabel>
          {view.unplaced.map((u) => <Button key={u.id} size='xs' onClick={() => place(u.id)}>{u.name}</Button>)}
        </div>
      ) : null}

      <svg {...zoomPan.svg} className='w-full flex-1 min-h-0 select-none touch-none' role='img' aria-label='board'
        onClick={(e) => { const cell = cellAt(e); if (cell) clickCell(cell, painting ? brush : null, repositioning) }}>
        <defs>
          <marker id='grip' viewBox='0 0 10 10' refX={9} refY={5} markerWidth={4} markerHeight={4} orient='auto-start-reverse'>
            <path d='M 0 0 L 10 5 L 0 10 z' className='fill-fg' />
          </marker>
        </defs>
        {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} />)}
        {view.tokens.map((t) => <Token key={t.id} token={t} hex={view.hex} onClick={() => clickToken(t.id)} />)}
        {view.binds.map((b) => <BindLink key={b.key} link={b} />)}
        {view.ghosts.map((g) => <Ghost key={g.id} ghost={g} hex={view.hex} />)}
        {view.floor.map((f) => <FloorItem key={f.itemId} item={f} onClick={() => clickFloorItem(f.itemId)} />)}
      </svg>
    </Panel>
  )
}

export function ZoomButtons({ zoomPan }: { zoomPan: ReturnType<typeof useZoomPan> }){
  return (<>
    <IconButton icon={ZoomIn} aria-label='zoom in' title='zoom in (or the wheel)' onClick={zoomPan.zoomIn} />
    <IconButton icon={ZoomOut} aria-label='zoom out' title='zoom out (or the wheel)' onClick={zoomPan.zoomOut} />
    <IconButton icon={Scan} aria-label='fit board' disabled={!zoomPan.zoomed} title='show the whole board' onClick={zoomPan.reset} />
  </>)
}

// The battle maps kept: one is played on with everyone off it, and the ground
// as it stands is kept under a name, as the profile's own or, on the dev
// server, for everyone.
function MapsRow({ canSave }: { canSave: boolean }){
  const { rows, devServer, save, load } = useBoardMaps()
  const [picked, setPicked] = useState('')
  const [name, setName] = useState('')
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>maps</SectionLabel>
      <select aria-label='battle map' className={selectClass} value={picked} onChange={(e) => setPicked(e.target.value)}>
        <option value=''>—</option>
        {rows.map((r) => <option key={r.id} value={r.id}>{r.name}{r.shared ? ' · shared' : ''}</option>)}
      </select>
      <Button size='xs' disabled={!picked} title='play on this ground: everyone comes off the board' onClick={() => load(picked)}>load</Button>
      {canSave ? (<>
        <span className='mx-1 text-line'>|</span>
        <TextInput aria-label='battle map name' placeholder='name it' value={name} onChange={(e) => setName(e.target.value)} className='w-28' />
        <Button size='xs' disabled={!name.trim()} onClick={() => save(name.trim(), false)}>save mine</Button>
        {devServer ? <Button size='xs' disabled={!name.trim()} onClick={() => save(name.trim(), true)}>save for all</Button> : null}
      </>) : null}
    </div>
  )
}

// The board's way in and out: a fight id names a mailbox a VTT module reads
// and writes; the clipboard carries the same snapshot by hand.
function LinkRow(){
  const { fight, setFight, auto, setAuto, push, pull, copy, paste } = useVttLink()
  const linked = fight.length > 0
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>link</SectionLabel>
      <TextInput aria-label='fight id' placeholder='fight id' value={fight} onChange={(e) => setFight(e.target.value.trim())} className='w-28' />
      <Button size='xs' disabled={!linked} onClick={push}>push</Button>
      <Button size='xs' disabled={!linked} onClick={pull}>pull</Button>
      <Button size='xs' disabled={!linked} selected={auto} onClick={() => setAuto(!auto)}>auto</Button>
      <span className='mx-1 text-line'>|</span>
      <Button size='xs' onClick={copy}>copy</Button>
      <Button size='xs' onClick={paste}>paste</Button>
    </div>
  )
}

const TERRAIN_FILL = {
  open: 'fill-surface',
  wall: 'fill-line',
  glass: 'fill-accent/25',
  water: 'fill-accent/10',
  rough: 'fill-muted/20',
} as const

const TERRAIN_LABEL = {
  open: null,
  wall: 'wall',
  glass: 'glass',
  water: 'water',
  rough: 'rough',
} as const

const TERRAIN_GLYPH = {
  open: '',
  wall: '',
  glass: '◇',
  water: '≈',
  rough: '∴',
} as const

const ZONE_FILL = {
  critical: 'fill-bad/60',
  hit: 'fill-bad/35',
  graze: 'fill-bad/15',
  miss: 'fill-bad/5',
} as const

// The cell a click on the board landed on, if it landed on one: the board
// takes one handler for all its cells, so a cell is the same drawing for as
// long as what it shows is.
export function cellAt(e: MouseEvent): Coord | null {
  const el = (e.target as Element).closest('[data-q]')
  return el ? { q: Number(el.getAttribute('data-q')), r: Number(el.getAttribute('data-r')) } : null
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b) && a.length === 0 && b.length === 0) return true
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)
}

function sameCellDrawing(a: { cell: BoardCellView, hex: string }, b: { cell: BoardCellView, hex: string }): boolean {
  return a.hex === b.hex && (Object.keys(a.cell) as (keyof BoardCellView)[]).every((k) => k === 'cell' || sameValue(a.cell[k], b.cell[k]))
}

export const Cell = memo(function Cell({ cell, hex }: { cell: BoardCellView, hex: string }){
  const fill = cell.isJumpTo ? 'fill-good/40'
    : cell.pathStep !== null ? 'fill-accent/40'
    : cell.swept ? 'fill-accent/20'
    : cell.zone ? ZONE_FILL[cell.zone]
    : cell.reachable || cell.jump || cell.step || cell.center ? 'fill-good/15'
    : cell.unseen ? 'fill-fg/50'
    : cell.threatened ? 'fill-bad/10'
    : cell.fire > 0 ? 'fill-injury-2/30'
    : cell.fuels.length > 0 ? 'fill-accent/15'
    : cell.suffocating ? 'fill-fg/25'
    : cell.visibility === 'zero' || cell.light === 'dark' ? 'fill-fg/35'
    : cell.light === 'dim' ? 'fill-fg/15'
    : cell.visibility === 'bad' ? 'fill-fg/15'
    : TERRAIN_FILL[cell.terrain]
  const stroke = cell.isDestination || cell.isJumpTo || cell.isCenter ? 'stroke-accent' : 'stroke-line'
  const title = [
    cell.key,
    cell.unseen ? 'out of sight' : null,
    TERRAIN_LABEL[cell.terrain],
    cell.strength,
    cell.elevation ? `${cell.elevation} m` : null,
    cell.fire > 0 ? `fire ${cell.fire}` : null,
    cell.fuels.length > 0 ? `coated in ${cell.fuels.join(' and ')}` : null,
    cell.suffocating ? 'suffocating gas' : null,
    cell.visibility === 'zero' ? 'no visibility' : cell.visibility === 'bad' ? 'bad visibility' : null,
    cell.light === 'dark' ? 'dark' : cell.light === 'dim' ? 'dim light' : cell.lit ? 'lit' : null,
    cell.noise > 0 ? `noise ${cell.noise}` : null,
    cell.reachable ? `${cell.reachable.steps} cells · ${cell.reachable.cost.AP} AP${cell.reachable.cost.STA ? ` ${cell.reachable.cost.STA} STA` : ''}` : null,
    cell.swept ? 'on the way of the move' : null,
    cell.jump ? 'evasive jump' : null,
    cell.step ? 'step here' : null,
    cell.center ? 'aim here' : null,
    cell.zone ? `explosion: ${cell.zone}` : cell.threatened ? 'in reach of the explosion' : null,
    cell.items.length > 0 ? `on the floor: ${cell.items.join(', ')}` : null,
  ].filter((s) => s !== null).join(' · ')
  return (
    <g transform={`translate(${cell.x} ${cell.y})`} className='cursor-pointer' data-q={cell.cell.q} data-r={cell.cell.r}>
      <title>{title}</title>
      <polygon points={hex} className={`${fill} ${stroke} hover:stroke-fg`} strokeWidth={0.06} />
      {TERRAIN_GLYPH[cell.terrain] && !cell.unseen ? <text textAnchor='middle' dominantBaseline='central' className='fill-muted pointer-events-none' fontSize={0.7}>{TERRAIN_GLYPH[cell.terrain]}</text> : null}
      {cell.elevationLabel ? <text x={0} y={-0.45} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.4}>{cell.elevationLabel}</text> : null}
      {cell.fire > 0 && cell.pathStep === null ? <text x={0} y={0.45} textAnchor='middle' className='fill-injury-2 pointer-events-none' fontSize={0.35}>{`🔥${cell.fire}`}</text> : null}
      {cell.noise > 0 && cell.fire === 0 && cell.pathStep === null ? <text x={0} y={0.45} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.35}>{`♪${cell.noise}`}</text> : null}
      {cell.pathStep !== null ? <text x={0} y={0.45} textAnchor='middle' className='fill-fg pointer-events-none' fontSize={0.4}>{cell.pathStep}</text> : null}
    </g>
  )
}, sameCellDrawing)

function Token({ token, hex, onClick }: { token: BoardTokenView, hex: string, onClick: () => void }){
  const ring = token.targetable ? 'stroke-bad' : token.isActive ? 'stroke-accent' : token.isInTurn ? 'stroke-good' : 'stroke-muted'
  return (
    <g className='cursor-pointer' onClick={onClick}>
      <title>{`${token.name}${token.awaited ? ' · may react: waiting on their answer' : ''}${token.elevation ? ` · ${token.elevation} m` : ''}${token.depth ? ` · ${token.depth} m deep` : ''}${token.shieldAngle !== null ? ' · in cover behind a body shield' : ''}`}</title>
      {token.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} className='fill-fg/15 stroke-none pointer-events-none' />)}
      <g transform={`translate(${token.x} ${token.y})`}>
        {token.awaited ? <circle r={0.82} className='fill-none stroke-accent animate-pulse pointer-events-none' strokeWidth={0.08} strokeDasharray='0.25 0.15' /> : null}
        <circle r={0.62} className={`fill-raised ${ring}`} strokeWidth={token.isActive || token.targetable ? 0.12 : 0.06} strokeDasharray={token.targetable ? '0.2 0.12' : undefined} />
        <text textAnchor='middle' dominantBaseline='central' className='fill-fg pointer-events-none' fontSize={0.45}>{token.name.slice(0, 2)}</text>
        <text y={0.95} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.3}>{token.name}</text>
        {token.shieldAngle !== null ? <rect x={0.72} y={-0.45} width={0.16} height={0.9} rx={0.05} transform={`rotate(${token.shieldAngle})`} className='fill-accent pointer-events-none' /> : null}
        {token.depth > 0 ? <text y={-0.8} textAnchor='middle' className='fill-accent pointer-events-none' fontSize={0.35}>{`↓${token.depth}`}</text> : null}
      </g>
    </g>
  )
}

// What is bound to what: a link between the two tokens, an arrowhead at each
// one held. A grapple is a solid line, a net's tether dashed, a held arc dotted
// in the accent colour.
const BIND_STROKE: Record<BoardBindView['kind'], { className: string; dash?: string }> = {
  grapple: { className: 'stroke-fg' },
  tether: { className: 'stroke-muted', dash: '0.3 0.15' },
  arc: { className: 'stroke-accent', dash: '0.05 0.12' },
  link: { className: 'stroke-accent', dash: '0.3 0.15 0.05 0.15' },
}

function BindLink({ link }: { link: BoardBindView }){
  const { className, dash } = BIND_STROKE[link.kind]
  return (
    <g>
      <title>{link.title}</title>
      <line x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y}
        className={className} strokeWidth={0.08} strokeLinecap='round' strokeDasharray={dash}
        markerStart={link.back ? 'url(#grip)' : undefined} markerEnd={link.forward ? 'url(#grip)' : undefined} />
    </g>
  )
}

// An item lying on the floor, drawn above any token on its cell.
function FloorItem({ item, onClick }: { item: BoardFloorItemView, onClick: () => void }){
  return (
    <g transform={`translate(${item.x} ${item.y})`} className={item.pickable || item.targetable ? 'cursor-pointer' : ''} onClick={onClick}>
      <title>{item.targetable ? `aim at ${item.name}` : item.pickable ? `pick up ${item.name}` : `on the floor: ${item.name}`}</title>
      <rect x={-0.16} y={-0.16} width={0.32} height={0.32} rx={0.05}
        className={item.pickable || item.targetable ? 'fill-accent stroke-fg hover:fill-good' : 'fill-muted stroke-line'} strokeWidth={0.04} />
    </g>
  )
}

// Where someone the settled push moves will stand once it lands: an outline
// of their token, clicks passing through to the board beneath.
function Ghost({ ghost, hex }: { ghost: BoardGhostView, hex: string }){
  return (
    <g className='pointer-events-none'>
      <title>{`${ghost.name} ends here`}</title>
      {ghost.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} className='fill-accent/10 stroke-none' />)}
      <g transform={`translate(${ghost.x} ${ghost.y})`}>
        <circle r={0.62} className='fill-none stroke-accent' strokeWidth={0.06} strokeDasharray='0.15 0.1' />
        <text textAnchor='middle' dominantBaseline='central' className='fill-accent' fontSize={0.45}>{ghost.name.slice(0, 2)}</text>
      </g>
    </g>
  )
}
