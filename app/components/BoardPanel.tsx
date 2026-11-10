'use client'
import { useState } from 'react'
import { useBoard } from '../hooks/useBoard'
import { useBoardMaps } from '../hooks/useBoardMaps'
import { useBoardVeil, useLitCell } from '../hooks/useBoardVeil'
import { useBoardCamera, useCellAt, type BoardCamera } from '../hooks/useBoardCanvas'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import type { BoardExtent, GroundRecipe, SurfaceTarget } from '../domain/scene/types'
import type { BoardView, BrushIcon } from '../domain/scene/projections/boardView'
import { BoardCanvas } from './BoardCanvas'
import { assetUrl } from '../board/assetUrl'
import type { TerrainBrush } from '../domain/types'
import { BRUSH_RADIUS_MOST, LIFT_LEAST, LIFT_MOST, LIGHT_LEVELS, GROUND_BRUSHES, SURFACE_TARGETS } from '../domain/lists'
import { useBoardLook } from '../hooks/useBoardLook'
import { RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton, Panel, SectionLabel, Segment, Segmented, TextInput, selectClass } from './ui'
import { SceneCards } from './SceneCards'
import { ClickMenuHost } from './ClickMenu'

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
  rise: '+½ m',
  sink: '−½ m',
  thinner: 'thinner',
  wider: 'wider',
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
  floor: 'floor',
  hole: 'stairwell',
  lattice: 'lattice',
  clear: 'clear',
  chord0: 'thin wall',
  chord1: 'thin wall',
  chord2: 'thin wall',
  chord3: 'thin wall',
  chord4: 'thin wall',
  chord5: 'thin wall',
}

const SURFACE_TARGET_LABEL: Record<SurfaceTarget, string> = { ground: 'ground', chords: 'thin wall' }

// A brush's button face: what it paints drawn small where there is a picture
// of it, else its name.
export function BrushFace({ brush, icons }: { brush: TerrainBrush, icons: Partial<Record<TerrainBrush, BrushIcon>> }) {
  const icon = icons[brush]
  if (!icon) return <>{BRUSH_LABEL[brush]}</>
  return (
    <svg viewBox='-1.15 -1.15 2.3 2.3' className='h-4 w-4' role='img' aria-label={BRUSH_LABEL[brush]}>
      <polygon points={toSvgPoints(icon.hex)} className='fill-none stroke-muted' strokeWidth={0.12} />
      <polyline points={toSvgPoints(icon.chord)} className='stroke-fg' strokeWidth={0.3} strokeLinecap='round' />
    </svg>
  )
}

const toSvgPoints = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(' ')

// The simulated grid: a hex field the GM paints, lights and repositions
// characters on, each placed by hand the first time, and the surface a move
// is walked on, zoomed with the wheel and panned by dragging. Everything drawn is a field of the board view; the panel
// only translates it into shapes.
export function BoardPanel(){
  const [fromActive, setFromActive] = useState(false)
  const look = useBoardLook()
  const [storey, setStorey] = useState<number | null | 'auto'>('auto')
  const { view, storeys, height, item, create, remove, clickCell, clickToken, clickFloorItem, place, placeItem, removeFloorItem, setOffExplosion, chargeByGM, setOffItem, picked, floorTool, setFloorTool, explosion, turn, light, laySurface, generateGround, resize, resizeWarning, brushIcons } = useBoard(fromActive, look, storey)
  const veil = useBoardVeil(view)
  const { setLit } = useLitCell(view, veil.setOver)
  const cellAt = useCellAt()
  const [brush, setBrush] = useState<TerrainBrush | null>(null)
  const [laying, setLaying] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
  const [onto, setOnto] = useState<SurfaceTarget>('ground')
  const [radius, setRadius] = useState(0)
  const [reposition, setReposition] = useState(false)
  const [tools, setTools] = useState(false)
  const { gmTools } = useRole()
  const gmBar = useGmBar()
  const open = tools && gmTools
  const camera = useBoardCamera()

  if (!view.present) {
    return (
      <Panel meta='no grid: everyone is in reach'
        title={<span className='inline-flex items-center gap-2'>Board <Button size='xs' tone='accent' aria-label='new board' disabled={gmBar !== null} title={gmBar ?? 'draw a hex grid for the scene'} onClick={() => create(6)}>simulate a grid</Button></span>}>
        {gmTools ? <MapsRow canSave={false} /> : null}
        <SceneCards />
      </Panel>
    )
  }

  const floor = gmTools ? floorTool : null
  const painting = open && floor === null && brush !== null
  const surfacing = open && floor === null && brush === null && laying !== null
  const repositioning = open && floor === null && reposition
  const grounding = floor === 'put' && item !== null
  const clearing = floor === 'remove'
  const exploding = floor === 'explode'
  const charging = floor === 'charge'
  const settingOff = floor === 'setoff'
  return (
    <Panel title='Board' meta={painting ? `painting ${BRUSH_LABEL[brush]}` : grounding ? `click a cell to lay ${item.name || item.refId} on it` : exploding ? 'click a cell to set the explosion off there' : charging ? 'click an item on the floor to charge it with the explosion described' : settingOff ? 'click an item on the floor to set its charge off' : clearing ? 'click an item on the floor to take it away' : repositioning ? 'click a cell to put the active character there, turn to turn them' : MODE_LABEL[view.mode]} pending={view.mode === 'path' || view.mode === 'jump' || view.mode === 'aim'}
      className='h-full'
      actions={<>
        <ZoomButtons camera={camera} />
        <Button size='xs' selected={look.front} aria-label='front view' title={look.front ? 'seen from the front: higher ground lifted up the screen. Click for the view from above' : 'seen from above. Click for the view from the front'} onClick={() => look.setFront(!look.front)}>{look.front ? 'front' : 'top'}</Button>
        {look.front ? <TextInput className='w-14' type='number' min={LIFT_LEAST} max={LIFT_MOST} step={0.05} aria-label='lift per metre' title='how far a metre of height lifts the ground up the screen' value={look.lift} onChange={(e) => look.setLift(Number(e.target.value))} /> : null}
        {storeys.length > 1 ?
          <Segmented label='storey'>
            <Segment selected={storey === 'auto'} title='the floor the active character stands on' onClick={() => setStorey('auto')}>theirs</Segment>
            {storeys.map((s) => <Segment key={s.label} selected={storey !== 'auto' && s.height === height} onClick={() => setStorey(s.height)}>{s.label}</Segment>)}
          </Segmented>
          : null}
        <Button size='xs' selected={fromActive} aria-label='see as the active character' title='draw only what the active character can see' onClick={() => setFromActive(!fromActive)}>their eyes</Button>
        {gmTools ? <Button size='xs' selected={tools} aria-label='board tools' onClick={() => { setTools(!tools); setBrush(null); setReposition(false); setFloorTool(null) }}>GM board tools</Button> : null}
        <IconButton icon={RotateCw} aria-label='turn' title={repositioning ? 'turn the active character clockwise' : 'turn the move clockwise, or the active character until the fight starts'} onClick={() => turn(repositioning)} />
        <Button size='xs' weight='subtle' tone='bad' aria-label='remove board' disabled={gmBar !== null || view.mode !== 'idle'} title={gmBar ?? (view.mode !== 'idle' ? 'an action is open' : 'take the grid away: everyone is in reach')} onClick={remove}>no grid</Button>
      </>}>

      {open ? (<>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>place</SectionLabel>
        <Button size='xs' aria-label='reposition' selected={reposition} title='put the active character anywhere, placed before or not, and turn them'
          onClick={() => { setReposition(!reposition); setBrush(null); setLaying(null); setFloorTool(null) }}>reposition</Button>
      </div>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>paint</SectionLabel>
        <Button size='xs' selected={brush === null}
          onClick={() => { setBrush(null); setLaying(null); setFloorTool(null) }}>control</Button>
        {GROUND_BRUSHES.map((b) =>
          <Button key={b} size='xs' selected={brush === b}
            onClick={() => { setBrush(brush === b ? null : b); setLaying(null); setReposition(false); setFloorTool(null) }}><BrushFace brush={b} icons={brushIcons} /></Button>)}
      </div>

      <BrushSize radius={radius} setRadius={setRadius} />

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>light</SectionLabel>
        <Segmented label='light'>
          {LIGHT_LEVELS.map((l) =>
            <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
        </Segmented>
      </div>
      <SurfaceRow surfaces={view.surfaces} laying={surfacing ? laying : null} frozen={frozen} freeze={setFrozen} onto={onto} setOnto={setOnto} lay={(name) => { setLaying(laying === name ? null : name); setFrozen(null); setBrush(null); setReposition(false); setFloorTool(null) }} />
      <GroundGenerator surfaces={view.surfaces} generate={generateGround} />
      <SizeRow key={`${view.extent.q},${view.extent.r},${view.extent.s}`} extent={view.extent} bar={view.mode !== 'idle' ? 'an action is open' : null} resize={resize} warningFor={resizeWarning} />
      <MapsRow canSave />
      </>) : null}

      {view.unplaced.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>unplaced</SectionLabel>
          {view.unplaced.map((u) => <Button key={u.id} size='xs' onClick={() => place(u.id)}>{u.name}</Button>)}
        </div>
      ) : null}

      <BoardCanvas className='w-full flex-1 min-h-0' label='board' view={view} veiled={veil.veiled} picked={picked} camera={camera} cellAt={cellAt} setLit={setLit}
        onCell={(cell) => { if (grounding) placeItem(cell); else if (surfacing && laying) laySurface(cell, laying, frozen, radius, onto); else if (exploding) setOffExplosion(explosion, cell); else clickCell(cell, painting ? brush : null, repositioning, radius) }}
        onToken={clickToken}
        onFloorItem={(id) => clearing ? removeFloorItem(id) : charging ? chargeByGM(id) : settingOff ? setOffItem(id) : clickFloorItem(id)} />
      <ClickMenuHost />
    </Panel>
  )
}

// The recipe a board's ground is generated from: the surfaces to lay, each
// with a weight, how much they gather in patches, and the seed that picks which
// of the grounds the recipe can make. Generating overwrites every cell.
export function GroundGenerator({ surfaces, generate }: { surfaces: BoardView['surfaces'], generate: (recipe: GroundRecipe, seed: number) => void }){
  const [entries, setEntries] = useState<GroundRecipe['entries']>([])
  const [clump, setClump] = useState(0.5)
  const [seed, setSeed] = useState(1)
  const left = surfaces.filter((s) => !entries.some((e) => e.surface === s.name))
  const usable = entries.some((e) => e.weight > 0)
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>generate</SectionLabel>
      <select className={selectClass} aria-label='add a surface to the recipe' value='' onChange={(e) => { if (e.target.value) setEntries([...entries, { surface: e.target.value, weight: 1 }]) }}>
        <option value=''>add surface</option>
        {left.map(({ name }) => <option key={name} value={name}>{name}</option>)}
      </select>
      {entries.map((entry) => (
        <span key={entry.surface} className='inline-flex flex-row items-center gap-1 text-xs'>
          {entry.surface}
          <TextInput className='w-14' type='number' min={0} aria-label={`${entry.surface} weight`} value={entry.weight} onChange={(e) => setEntries(entries.map((x) => (x === entry ? { ...x, weight: Number(e.target.value) } : x)))} />
          <Button size='xs' aria-label={`remove ${entry.surface}`} onClick={() => setEntries(entries.filter((x) => x !== entry))}>x</Button>
        </span>
      ))}
      <label className='inline-flex flex-row items-center gap-1 text-xs'>
        clump
        <input type='range' min={0} max={1} step={0.05} aria-label='clumping' value={clump} onChange={(e) => setClump(Number(e.target.value))} />
      </label>
      <TextInput className='w-24' type='number' aria-label='generator seed' value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
      <Button size='xs' disabled={!usable} onClick={() => generate({ entries, clump }, seed)}>generate</Button>
      <Button size='xs' disabled={!usable} title='a new seed, and generate with it' onClick={() => { const next = Math.floor(Math.random() * 0x7fffffff); setSeed(next); generate({ entries, clump }, next) }}>reroll</Button>
    </div>
  )
}

// How wide the brush reaches, in steps around the cell clicked, for the paint
// and the surfaces alike.
export function BrushSize({ radius, setRadius }: { radius: number, setRadius: (radius: number) => void }){
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>brush size</SectionLabel>
      <Button size='xs' disabled={radius <= 0} aria-label='smaller brush' onClick={() => setRadius(radius - 1)}>-</Button>
      <span className='text-xs w-4 text-center'>{radius}</span>
      <Button size='xs' disabled={radius >= BRUSH_RADIUS_MOST} aria-label='bigger brush' onClick={() => setRadius(radius + 1)}>+</Button>
    </div>
  )
}

// The board's own surface, and the one laid cell by cell with a click.
export function SurfaceRow({ surfaces, laying, lay, frozen, freeze, onto, setOnto }: { surfaces: BoardView['surfaces'], laying: string | null, lay: (name: string) => void, frozen: string | null, freeze: (art: string | null) => void, onto: SurfaceTarget, setOnto: (onto: SurfaceTarget) => void }){
  const arts = onto === 'ground' ? surfaces.find((s) => s.name === laying)?.arts ?? [] : []
  return (<>
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>surface</SectionLabel>
      <Segmented label='lay onto'>
        {SURFACE_TARGETS.map((t) => <Segment key={t} selected={onto === t} title={t === 'ground' ? 'lay the surface on the ground of the cell' : 'draw only the thin walls of the cell with the wall picture of the surface'} onClick={() => setOnto(t)}>{SURFACE_TARGET_LABEL[t]}</Segment>)}
      </Segmented>
      {surfaces.map(({ name }) => <Button key={name} size='xs' selected={laying === name} onClick={() => lay(name)}>{name}</Button>)}
    </div>
    {arts.length > 0 ? (
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>art</SectionLabel>
        <Button size='xs' selected={frozen === null} onClick={() => freeze(null)}>random</Button>
        {arts.map((src) => (
          <Button key={src} size='xs' selected={frozen === src} title={src} aria-label={src} onClick={() => freeze(frozen === src ? null : src)}>
            <span className='inline-block h-5 w-5 rounded-sm bg-cover bg-center' style={{ backgroundImage: `url(${assetUrl(src)})` }} />
          </Button>
        ))}
      </div>
    ) : null}
  </>)
}

export function ZoomButtons({ camera }: { camera: BoardCamera }){
  return (<>
    <IconButton icon={ZoomIn} aria-label='zoom in' title='zoom in (or the wheel)' onClick={camera.zoomIn} />
    <IconButton icon={ZoomOut} aria-label='zoom out' title='zoom out (or the wheel)' onClick={camera.zoomOut} />
    <IconButton icon={Scan} aria-label='fit board' disabled={!camera.zoomed} title='show the whole board' onClick={camera.reset} />
  </>)
}

// The board widened or narrowed around its centre. A shrink waits for the GM
// to confirm what it takes off the board.
function SizeRow({ extent, bar, resize, warningFor }: { extent: BoardExtent, bar: string | null, resize: (extent: BoardExtent) => void, warningFor: (extent: BoardExtent) => string | null }){
  const [size, setSize] = useState(extent)
  const [warning, setWarning] = useState<string | null>(null)
  const apply = () => { const w = warningFor(size); if (w) setWarning(w); else resize(size) }
  const unchanged = size.q === extent.q && size.r === extent.r && size.s === extent.s
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>size</SectionLabel>
      {(['q', 'r', 's'] as const).map((axis) => (
        <TextInput key={axis} className='w-16' type='number' min={1} max={30} aria-label={`board extent ${axis}`} value={size[axis]} onChange={(e) => { setSize({ ...size, [axis]: Number(e.target.value) }); setWarning(null) }} />
      ))}
      <Button size='xs' disabled={bar !== null || unchanged} title={bar ?? 'widen or narrow the board around its centre, along each hex axis'} onClick={apply}>resize</Button>
      {warning ? (<>
        <span className='text-xs'>{warning}</span>
        <Button size='xs' weight='solid' tone='bad' aria-label='confirm shrink' disabled={bar !== null} onClick={() => { resize(size); setWarning(null) }}>shrink</Button>
        <Button size='xs' weight='ghost' aria-label='cancel shrink' onClick={() => setWarning(null)}>cancel</Button>
      </>) : null}
    </div>
  )
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
