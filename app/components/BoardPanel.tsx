'use client'
import { useState } from 'react'
import { useBoard } from '../hooks/useBoard'
import { useVttLink } from '../hooks/useVttLink'
import type { BoardCellView, BoardFloorItemView, BoardGhostView, BoardBindView, BoardTokenView } from '../domain/scene/projections/boardView'
import type { TerrainBrush } from '../domain/types'
import { LIGHT_LEVELS, TERRAIN_BRUSHES } from '../domain/lists'
import { Button, Panel, SectionLabel, TextInput } from './ui'
import { SceneCards } from './SceneCards'

const MODE_LABEL = {
  idle: 'click a cell to place the active character, or an item to pick it up',
  path: 'click cells to walk the move',
  jump: 'click a cell to jump there',
  aim: 'click a cell to aim',
  locked: 'an action is open',
} as const

const BRUSH_LABEL: Record<TerrainBrush, string> = {
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

// The simulated grid: a hex field the table can paint and place characters
// on by hand, and the surface a move is walked on. Everything drawn is a
// field of the board view; the panel only translates it into shapes.
export function BoardPanel(){
  const { view, create, clickCell, clickToken, clickFloorItem, place, turn, light } = useBoard()
  const [brush, setBrush] = useState<TerrainBrush | null>(null)
  const [tools, setTools] = useState(false)

  if (!view.present) {
    return (
      <Panel meta='no grid: everyone is in reach'
        title={<span className='inline-flex items-center gap-2'>Board <Button size='xs' variant='primary' aria-label='new board' onClick={() => create(6)}>simulate a grid</Button></span>}>
        <SceneCards />
      </Panel>
    )
  }

  const painting = brush !== null
  return (
    <Panel title='Board' meta={painting ? `painting ${BRUSH_LABEL[brush]}` : MODE_LABEL[view.mode]} pending={view.mode === 'path' || view.mode === 'jump' || view.mode === 'aim'}
      className='h-full'
      actions={<>
        <Button size='xs' {...(tools ? { variant: 'primary' as const, className: 'bg-accent/15' } : {})} aria-label='board tools' onClick={() => { setTools(!tools); setBrush(null) }}>paint &amp; light</Button>
        <Button size='xs' variant='ghost' aria-label='turn' title='turn clockwise' onClick={turn}>↻</Button>
      </>}>

      {tools ? (<>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>paint</SectionLabel>
        <Button size='xs' variant={brush === null ? 'primary' : 'default'} className={brush === null ? 'bg-accent/15' : ''}
          onClick={() => setBrush(null)}>control</Button>
        {TERRAIN_BRUSHES.map((b) =>
          <Button key={b} size='xs' variant={brush === b ? 'primary' : 'default'} className={brush === b ? 'bg-accent/15' : ''}
            onClick={() => setBrush(brush === b ? null : b)}>{BRUSH_LABEL[b]}</Button>)}
      </div>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>light</SectionLabel>
        {LIGHT_LEVELS.map((l) =>
          <Button key={l} size='xs' variant={view.light === l ? 'primary' : 'default'} className={view.light === l ? 'bg-accent/15' : ''}
            onClick={() => light(l)}>{l}</Button>)}
      </div>
      <LinkRow />
      </>) : null}

      {view.unplaced.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>unplaced</SectionLabel>
          {view.unplaced.map((u) => <Button key={u.id} size='xs' onClick={() => place(u.id)}>{u.name}</Button>)}
        </div>
      ) : null}

      <svg viewBox={view.viewBox} className='w-full flex-1 min-h-0 select-none' role='img' aria-label='board'>
        <defs>
          <marker id='grip' viewBox='0 0 10 10' refX={9} refY={5} markerWidth={4} markerHeight={4} orient='auto-start-reverse'>
            <path d='M 0 0 L 10 5 L 0 10 z' className='fill-fg' />
          </marker>
        </defs>
        {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} onClick={() => clickCell(c.cell, brush)} />)}
        {view.tokens.map((t) => <Token key={t.id} token={t} hex={view.hex} onClick={() => clickToken(t.id)} />)}
        {view.binds.map((b) => <BindLink key={b.key} link={b} />)}
        {view.ghosts.map((g) => <Ghost key={g.id} ghost={g} hex={view.hex} />)}
        {view.floor.map((f) => <FloorItem key={f.itemId} item={f} onClick={() => clickFloorItem(f.itemId)} />)}
      </svg>
    </Panel>
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
      <Button size='xs' disabled={!linked} variant={auto ? 'primary' : 'default'} className={auto ? 'bg-accent/15' : ''} onClick={() => setAuto(!auto)}>auto</Button>
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

function Cell({ cell, hex, onClick }: { cell: BoardCellView, hex: string, onClick: () => void }){
  const fill = cell.isJumpTo ? 'fill-good/40'
    : cell.pathStep !== null ? 'fill-accent/40'
    : cell.zone ? ZONE_FILL[cell.zone]
    : cell.reachable || cell.jump || cell.step || cell.center ? 'fill-good/15'
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
    cell.jump ? 'evasive jump' : null,
    cell.step ? 'step here' : null,
    cell.center ? 'aim here' : null,
    cell.zone ? `explosion: ${cell.zone}` : cell.threatened ? 'in reach of the explosion' : null,
    cell.items.length > 0 ? `on the floor: ${cell.items.join(', ')}` : null,
  ].filter((s) => s !== null).join(' · ')
  return (
    <g transform={`translate(${cell.x} ${cell.y})`} className='cursor-pointer' onClick={onClick}>
      <title>{title}</title>
      <polygon points={hex} className={`${fill} ${stroke} hover:stroke-fg`} strokeWidth={0.06} />
      {TERRAIN_GLYPH[cell.terrain] ? <text textAnchor='middle' dominantBaseline='central' className='fill-muted pointer-events-none' fontSize={0.7}>{TERRAIN_GLYPH[cell.terrain]}</text> : null}
      {cell.elevationLabel ? <text x={0} y={-0.45} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.4}>{cell.elevationLabel}</text> : null}
      {cell.fire > 0 && cell.pathStep === null ? <text x={0} y={0.45} textAnchor='middle' className='fill-injury-2 pointer-events-none' fontSize={0.35}>{`🔥${cell.fire}`}</text> : null}
      {cell.noise > 0 && cell.fire === 0 && cell.pathStep === null ? <text x={0} y={0.45} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.35}>{`♪${cell.noise}`}</text> : null}
      {cell.pathStep !== null ? <text x={0} y={0.45} textAnchor='middle' className='fill-fg pointer-events-none' fontSize={0.4}>{cell.pathStep}</text> : null}
    </g>
  )
}

function Token({ token, hex, onClick }: { token: BoardTokenView, hex: string, onClick: () => void }){
  const ring = token.targetable ? 'stroke-bad' : token.isActive ? 'stroke-accent' : token.isInTurn ? 'stroke-good' : 'stroke-muted'
  return (
    <g className='cursor-pointer' onClick={onClick}>
      <title>{`${token.name}${token.elevation ? ` · ${token.elevation} m` : ''}${token.depth ? ` · ${token.depth} m deep` : ''}${token.shieldAngle !== null ? ' · in cover behind a body shield' : ''}`}</title>
      {token.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} className='fill-fg/15 stroke-none pointer-events-none' />)}
      <g transform={`translate(${token.x} ${token.y})`}>
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
