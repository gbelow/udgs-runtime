'use client'
import { useState } from 'react'
import { useBoard } from '../hooks/useBoard'
import { useVttLink } from '../hooks/useVttLink'
import type { BoardCellView, BoardTokenView } from '../domain/combat/lenses/boardView'
import type { TerrainBrush } from '../domain/types'
import { TERRAIN_BRUSHES } from '../domain/lists'
import { Button, Panel, SectionLabel, TextInput } from './ui'

const MODE_LABEL = {
  idle: 'click a cell to place the active character',
  path: 'click cells to walk the move',
  jump: 'click a cell to jump there',
  locked: 'an action is open',
} as const

const BRUSH_LABEL: Record<TerrainBrush, string> = {
  wall: 'wall',
  water: 'water',
  rough: 'rough',
  raise: '+1 m',
  lower: '−1 m',
  clear: 'clear',
}

// The simulated grid: a hex field the table can paint and place characters
// on by hand, and the surface a move is walked on. Everything drawn is a
// field of the board view; the panel only translates it into shapes.
export function BoardPanel(){
  const { view, create, clickCell, clickToken, place, turn } = useBoard()
  const [brush, setBrush] = useState<TerrainBrush | null>(null)

  if (!view.present) {
    return (
      <Panel title='Board' meta='no grid: everyone is in reach'>
        <div><Button variant='primary' aria-label='new board' onClick={() => create(6)}>simulate a grid</Button></div>
      </Panel>
    )
  }

  const painting = brush !== null
  return (
    <Panel title='Board' meta={painting ? `painting ${BRUSH_LABEL[brush]}` : MODE_LABEL[view.mode]} pending={view.mode === 'path' || view.mode === 'jump'}
      actions={<Button size='xs' variant='ghost' aria-label='turn' title='turn clockwise' onClick={turn}>↻</Button>}>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>paint</SectionLabel>
        {TERRAIN_BRUSHES.map((b) =>
          <Button key={b} size='xs' variant={brush === b ? 'primary' : 'default'} className={brush === b ? 'bg-accent/15' : ''}
            onClick={() => setBrush(brush === b ? null : b)}>{BRUSH_LABEL[b]}</Button>)}
      </div>

      {view.unplaced.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>unplaced</SectionLabel>
          {view.unplaced.map((u) => <Button key={u.id} size='xs' onClick={() => place(u.id)}>{u.name}</Button>)}
        </div>
      ) : null}

      <svg viewBox={view.viewBox} className='w-full select-none' role='img' aria-label='board'>
        {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} onClick={() => clickCell(c.cell, brush)} />)}
        {view.tokens.map((t) => <Token key={t.id} token={t} hex={view.hex} onClick={() => clickToken(t.id, t.targetable)} />)}
      </svg>

      <LinkRow />
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
  water: 'fill-accent/10',
  rough: 'fill-muted/20',
} as const

const TERRAIN_GLYPH = {
  open: '',
  wall: '',
  water: '≈',
  rough: '∴',
} as const

function Cell({ cell, hex, onClick }: { cell: BoardCellView, hex: string, onClick: () => void }){
  const fill = cell.isJumpTo ? 'fill-good/40' : cell.pathStep !== null ? 'fill-accent/40' : cell.reachable || cell.jump ? 'fill-good/15' : TERRAIN_FILL[cell.terrain]
  const stroke = cell.isDestination || cell.isJumpTo ? 'stroke-accent' : 'stroke-line'
  const title = [
    cell.key,
    cell.terrain !== 'open' ? cell.terrain : null,
    cell.elevation ? `${cell.elevation} m` : null,
    cell.reachable ? `${cell.reachable.steps} cells · ${cell.reachable.cost.AP} AP${cell.reachable.cost.STA ? ` ${cell.reachable.cost.STA} STA` : ''}` : null,
    cell.jump ? 'evasive jump' : null,
  ].filter((s) => s !== null).join(' · ')
  return (
    <g transform={`translate(${cell.x} ${cell.y})`} className='cursor-pointer' onClick={onClick}>
      <title>{title}</title>
      <polygon points={hex} className={`${fill} ${stroke} hover:stroke-fg`} strokeWidth={0.06} />
      {TERRAIN_GLYPH[cell.terrain] ? <text textAnchor='middle' dominantBaseline='central' className='fill-muted pointer-events-none' fontSize={0.7}>{TERRAIN_GLYPH[cell.terrain]}</text> : null}
      {cell.elevationLabel ? <text x={0} y={-0.45} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.4}>{cell.elevationLabel}</text> : null}
      {cell.pathStep !== null ? <text x={0} y={0.45} textAnchor='middle' className='fill-fg pointer-events-none' fontSize={0.4}>{cell.pathStep}</text> : null}
    </g>
  )
}

function Token({ token, hex, onClick }: { token: BoardTokenView, hex: string, onClick: () => void }){
  const ring = token.targetable ? 'stroke-bad' : token.isActive ? 'stroke-accent' : token.isInTurn ? 'stroke-good' : 'stroke-muted'
  return (
    <g className='cursor-pointer' onClick={onClick}>
      <title>{`${token.name}${token.elevation ? ` · ${token.elevation} m` : ''}`}</title>
      {token.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} className='fill-fg/15 stroke-none pointer-events-none' />)}
      <g transform={`translate(${token.x} ${token.y})`}>
        <circle r={0.62} className={`fill-raised ${ring}`} strokeWidth={token.isActive || token.targetable ? 0.12 : 0.06} strokeDasharray={token.targetable ? '0.2 0.12' : undefined} />
        <text textAnchor='middle' dominantBaseline='central' className='fill-fg pointer-events-none' fontSize={0.45}>{token.name.slice(0, 2)}</text>
        <text y={0.95} textAnchor='middle' className='fill-muted pointer-events-none' fontSize={0.3}>{token.name}</text>
      </g>
    </g>
  )
}
