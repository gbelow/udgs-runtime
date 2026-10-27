'use client'
import { Fragment, memo, useState, type MouseEvent } from 'react'
import { useBoard } from '../hooks/useBoard'
import { useBoardMaps } from '../hooks/useBoardMaps'
import { useRole } from '../hooks/useRole'
import { useGmBar } from '../hooks/useControl'
import { useZoomPan } from '../hooks/useZoomPan'
import type { BoardExtent, Coord, GroundRecipe } from '../domain/scene/types'
import type { BoardView, BoardCellView, BoardFloorItemView, BoardGhostView, BoardBindView, BoardTokenView } from '../domain/scene/projections/boardView'
import type { TerrainBrush } from '../domain/types'
import { LIGHT_LEVELS, TERRAIN_BRUSHES } from '../domain/lists'
import { RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, IconButton, Panel, SectionLabel, Segment, Segmented, TextInput, selectClass } from './ui'
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
  const { view, item, create, remove, clickCell, clickToken, clickFloorItem, place, placeItem, removeFloorItem, setOffExplosion, chargeByGM, setOffItem, picked, floorTool, setFloorTool, explosion, turn, light, laySurface, generateGround, resize, resizeWarning } = useBoard(fromActive)
  const [brush, setBrush] = useState<TerrainBrush | null>(null)
  const [laying, setLaying] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
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
        <ZoomButtons zoomPan={zoomPan} />
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
        {TERRAIN_BRUSHES.map((b) =>
          <Button key={b} size='xs' selected={brush === b}
            onClick={() => { setBrush(brush === b ? null : b); setLaying(null); setReposition(false); setFloorTool(null) }}>{BRUSH_LABEL[b]}</Button>)}
      </div>

      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>light</SectionLabel>
        <Segmented label='light'>
          {LIGHT_LEVELS.map((l) =>
            <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
        </Segmented>
      </div>
      <SurfaceRow surfaces={view.surfaces} laying={surfacing ? laying : null} frozen={frozen} freeze={setFrozen} lay={(name) => { setLaying(laying === name ? null : name); setFrozen(null); setBrush(null); setReposition(false); setFloorTool(null) }} />
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

      <svg {...zoomPan.svg} className='w-full flex-1 min-h-0 select-none touch-none' role='img' aria-label='board'
        onClick={(e) => { const cell = cellAt(e); if (!cell) return; if (grounding) placeItem(cell); else if (surfacing && laying) laySurface(cell, laying, frozen); else if (exploding) setOffExplosion(explosion, cell); else clickCell(cell, painting ? brush : null, repositioning) }}>
        <defs>
          <marker id='grip' viewBox='0 0 10 10' refX={9} refY={5} markerWidth={4} markerHeight={4} orient='auto-start-reverse'>
            <path d='M 0 0 L 10 5 L 0 10 z' className='fill-fg' />
          </marker>
        </defs>
        <SurfaceLayer view={view} />
        {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} />)}
        <ShadeLayer view={view} />
        {view.tokens.map((t) => <Token key={t.id} token={t} hex={view.hex} picked={picked.includes(t.id)} onClick={() => clickToken(t.id)} />)}
        {view.binds.map((b) => <BindLink key={b.key} link={b} />)}
        {view.ghosts.map((g) => <Ghost key={g.id} ghost={g} hex={view.hex} />)}
        {view.floor.map((f) => <FloorItem key={f.itemId} item={f} onClick={() => clearing ? removeFloorItem(f.itemId) : charging ? chargeByGM(f.itemId) : settingOff ? setOffItem(f.itemId) : clickFloorItem(f.itemId)} />)}
      </svg>
    </Panel>
  )
}

// The ground of a board, drawn under its cells. Each picture is one small
// texture repeated over the board in the units the tokens are placed in, so
// that it runs on from hex to hex and is decoded once, and it is shown through
// a mask of the hexes laid with it, grown outwards and roughened with noise:
// where two pictures meet, the one drawn later pushes a ragged edge into the
// other's hexes instead of cutting along the hex edge. How far a surface
// spreads (none keeps the hex edge), which is drawn over which and the width of
// the ridge along its edge are the surface's own. A ridge is a wet band on the
// ground just outside the edge, tinted over whatever lies there and edged with
// a pale line, drawn right after its picture so that a surface drawn over it
// covers it.
const ROUGHNESS = 0.8
const ROUGH_FREQUENCY = 0.3
const FEATHER = 0.1
const ROUGH_SEED = 7
const ROUGH_MARGIN = 2
const RIDGE_TINT = 0.3
const RIDGE_SOFT = 0.3
const LIP = 0.3
const LIP_OPACITY = 0.5

export function SurfaceLayer({ view }: { view: BoardView }){
  const { frame, hex } = view
  const region = { x: frame.x - ROUGH_MARGIN, y: frame.y - ROUGH_MARGIN, width: frame.width + 2 * ROUGH_MARGIN, height: frame.height + 2 * ROUGH_MARGIN }
  const body = (art: BoardView['arts'][number], i: number) => (
    <g filter={art.bleed > 0 ? 'url(#surface-rough)' : undefined}>
      {view.cells.filter((c) => c.art === i).map((c) => (
        <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} fill='white' stroke={art.bleed > 0 ? 'white' : 'none'} strokeWidth={art.bleed * 2} strokeLinejoin='round' />
      ))}
    </g>
  )
  return (
    <g className='pointer-events-none'>
      <defs>
        {view.arts.map((art, i) => (
          <pattern key={i} id={`surface-${i}`} patternUnits='userSpaceOnUse' width={art.tile} height={art.tile} patternTransform={`translate(${art.offsetX} ${art.offsetY})`}>
            <image href={art.src} width={art.tile} height={art.tile} />
          </pattern>
        ))}
        <filter id='surface-rough' filterUnits='userSpaceOnUse' {...region}>
          <feTurbulence type='fractalNoise' baseFrequency={ROUGH_FREQUENCY} numOctaves={1} seed={ROUGH_SEED} result='noise' />
          <feDisplacementMap in='SourceGraphic' in2='noise' scale={ROUGHNESS} xChannelSelector='R' yChannelSelector='G' result='displaced' />
          <feGaussianBlur in='displaced' stdDeviation={FEATHER} />
        </filter>
        {view.arts.map((art, i) => (
          <mask key={i} id={`surface-mask-${i}`} maskUnits='userSpaceOnUse' {...region}>{body(art, i)}</mask>
        ))}
        <clipPath id='surface-board'>
          {view.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} />)}
        </clipPath>
        {view.arts.map((art, i) => art.ridge <= 0 ? null : (<Fragment key={i}>
          <filter id={`surface-ridge-${i}`} filterUnits='userSpaceOnUse' {...region}>
            <feMorphology in='SourceAlpha' operator='dilate' radius={art.ridge} result='fat' />
            <feComposite in='fat' in2='SourceAlpha' operator='out' result='ring' />
            <feGaussianBlur in='ring' stdDeviation={art.ridge * RIDGE_SOFT} result='soft' />
            <feFlood floodColor='white' />
            <feComposite in2='soft' operator='in' />
          </filter>
          <filter id={`surface-lip-${i}`} filterUnits='userSpaceOnUse' {...region}>
            <feMorphology in='SourceAlpha' operator='dilate' radius={art.ridge * LIP} result='fat' />
            <feComposite in='fat' in2='SourceAlpha' operator='out' result='ring' />
            <feFlood floodColor='white' />
            <feComposite in2='ring' operator='in' />
          </filter>
          <mask id={`surface-ridge-mask-${i}`} maskUnits='userSpaceOnUse' {...region}>
            <g filter={`url(#surface-ridge-${i})`}>{body(art, i)}</g>
          </mask>
          <mask id={`surface-lip-mask-${i}`} maskUnits='userSpaceOnUse' {...region}>
            <g filter={`url(#surface-lip-${i})`}>{body(art, i)}</g>
          </mask>
        </Fragment>))}
      </defs>
      <g clipPath='url(#surface-board)'>
        {view.arts.map((art, i) => (<Fragment key={i}>
          <rect {...region} fill={`url(#surface-${i})`} mask={`url(#surface-mask-${i})`} />
          {art.ridge > 0 ? (<>
            <rect {...region} fill='black' opacity={RIDGE_TINT} mask={`url(#surface-ridge-mask-${i})`} />
            <rect {...region} fill='white' opacity={LIP_OPACITY} mask={`url(#surface-lip-mask-${i})`} />
          </>) : null}
        </Fragment>))}
      </g>
    </g>
  )
}

// The light and the fog of a board, drawn over its cells: where no light
// reaches, where the eyes of the one looking do not, and where the ground is
// misty, each as a veil shown through a mask of the cells it covers, blurred so
// that the dark falls off softly instead of in steps of whole hexes. A cell is
// drawn in white a little past its edge and its level is the opacity of the
// whole group, so that the blur fades from full colour at the board's rim and
// cells of one level do not add up. The ground layer's clip keeps it on the
// board.
const SHADE_BLUR = 0.35
const SHADE_BLEED = 0.45
const NIGHT_DIM = 0.6
const NIGHT_DARK = 0.85
const UNSEEN = 0.92
const MIST_BAD = 0.35
const MIST_ZERO = 0.7
const GLOW = 0.2

// The cells of each level of a veil, weakest first, so that a stronger one is
// drawn over a weaker.
function levelsOf(cells: BoardCellView[], levelOf: (c: BoardCellView) => number): { level: number, cells: BoardCellView[] }[] {
  const levels = new Map<number, BoardCellView[]>()
  for (const c of cells) {
    const level = levelOf(c)
    if (level > 0) levels.set(level, [...(levels.get(level) ?? []), c])
  }
  return [...levels.entries()].sort(([a], [b]) => a - b).map(([level, at]) => ({ level, cells: at }))
}

export function ShadeLayer({ view }: { view: BoardView }){
  const { frame, hex } = view
  const region = { x: frame.x - ROUGH_MARGIN, y: frame.y - ROUGH_MARGIN, width: frame.width + 2 * ROUGH_MARGIN, height: frame.height + 2 * ROUGH_MARGIN }
  const veils = [
    { id: 'night', fill: 'black', opacity: 1, levels: levelsOf(view.cells, (c) => (c.unseen ? UNSEEN : c.light === 'dark' ? NIGHT_DARK : c.light === 'dim' ? NIGHT_DIM : 0)) },
    { id: 'mist', fill: '#c9d4dc', opacity: 1, levels: levelsOf(view.cells, (c) => (c.visibility === null ? 0 : c.visibility === 'zero' ? MIST_ZERO : MIST_BAD)) },
    { id: 'glow', fill: '#ffb45a', opacity: GLOW, levels: levelsOf(view.cells, (c) => (c.lit && !c.unseen ? 1 : 0)) },
  ].filter((v) => v.levels.length > 0)
  if (veils.length === 0) return null
  return (
    <g className='pointer-events-none' clipPath='url(#surface-board)'>
      <defs>
        <filter id='shade-soft' filterUnits='userSpaceOnUse' {...region}>
          <feGaussianBlur stdDeviation={SHADE_BLUR} />
        </filter>
        {veils.map((v) => (
          <mask key={v.id} id={`shade-${v.id}`} maskUnits='userSpaceOnUse' {...region}>
            <g filter='url(#shade-soft)'>
              {v.levels.map(({ level, cells }) => (
                <g key={level} opacity={level}>
                  {cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} fill='white' stroke='white' strokeWidth={2 * SHADE_BLEED} strokeLinejoin='round' />)}
                </g>
              ))}
            </g>
          </mask>
        ))}
      </defs>
      {veils.map((v) => <rect key={v.id} {...region} fill={v.fill} opacity={v.opacity} mask={`url(#shade-${v.id})`} />)}
    </g>
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

// The board's own surface, and the one laid cell by cell with a click.
export function SurfaceRow({ surfaces, laying, lay, frozen, freeze }: { surfaces: BoardView['surfaces'], laying: string | null, lay: (name: string) => void, frozen: string | null, freeze: (art: string | null) => void }){
  const arts = surfaces.find((s) => s.name === laying)?.arts ?? []
  return (<>
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>surface</SectionLabel>
      {surfaces.map(({ name }) => <Button key={name} size='xs' selected={laying === name} onClick={() => lay(name)}>{name}</Button>)}
    </div>
    {arts.length > 0 ? (
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>art</SectionLabel>
        <Button size='xs' selected={frozen === null} onClick={() => freeze(null)}>random</Button>
        {arts.map((src) => (
          <Button key={src} size='xs' selected={frozen === src} title={src} aria-label={src} onClick={() => freeze(frozen === src ? null : src)}>
            <span className='inline-block h-5 w-5 rounded-sm bg-cover bg-center' style={{ backgroundImage: `url(${src})` }} />
          </Button>
        ))}
      </div>
    ) : null}
  </>)
}

export function ZoomButtons({ zoomPan }: { zoomPan: ReturnType<typeof useZoomPan> }){
  return (<>
    <IconButton icon={ZoomIn} aria-label='zoom in' title='zoom in (or the wheel)' onClick={zoomPan.zoomIn} />
    <IconButton icon={ZoomOut} aria-label='zoom out' title='zoom out (or the wheel)' onClick={zoomPan.zoomOut} />
    <IconButton icon={Scan} aria-label='fit board' disabled={!zoomPan.zoomed} title='show the whole board' onClick={zoomPan.reset} />
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
    : cell.threatened ? 'fill-bad/10'
    : cell.fire > 0 ? 'fill-injury-2/30'
    : cell.fuels.length > 0 ? 'fill-accent/15'
    : cell.suffocating ? 'fill-fg/25'
    : cell.art !== null && cell.terrain === 'open' ? 'fill-surface/0'
    : TERRAIN_FILL[cell.terrain]
  const stroke = cell.isDestination || cell.isJumpTo || cell.isCenter ? 'stroke-accent' : cell.art !== null ? 'stroke-line/30' : 'stroke-line'
  const title = [
    cell.key,
    cell.unseen ? 'out of sight' : null,
    TERRAIN_LABEL[cell.terrain],
    cell.surface,
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

function Token({ token, hex, picked, onClick }: { token: BoardTokenView, hex: string, picked: boolean, onClick: () => void }){
  const ring = picked ? 'stroke-accent' : token.targetable ? 'stroke-bad' : token.isActive ? 'stroke-accent' : token.isInTurn ? 'stroke-good' : 'stroke-muted'
  const [broken, setBroken] = useState(false)
  const clip = `token-clip-${token.id}`
  return (
    <g className='cursor-pointer' onClick={onClick}>
      <title>{`${token.name}${token.awaited ? ' · may react: waiting on their answer' : ''}${token.elevation ? ` · ${token.elevation} m` : ''}${token.depth ? ` · ${token.depth} m deep` : ''}${token.shieldAngle !== null ? ' · in cover behind a body shield' : ''}`}</title>
      {token.cells.map((c) => <polygon key={c.key} points={hex} transform={`translate(${c.x} ${c.y})`} className='fill-fg/15 stroke-none pointer-events-none' />)}
      <g transform={`translate(${token.x} ${token.y})`}>
        {token.awaited ? <circle r={0.82} className='fill-none stroke-accent animate-pulse pointer-events-none' strokeWidth={0.08} strokeDasharray='0.25 0.15' /> : null}
        <circle r={0.62} className={`fill-raised ${ring}`} strokeWidth={picked || token.isActive || token.targetable ? 0.12 : 0.06} strokeDasharray={token.targetable ? '0.2 0.12' : undefined} />
        {token.image && !broken ? (
          <>
            <clipPath id={clip}><circle r={0.62} /></clipPath>
            <image href={token.image} x={-0.62} y={-0.62} width={1.24} height={1.24} preserveAspectRatio='xMidYMid slice' clipPath={`url(#${clip})`} className='pointer-events-none' onError={() => setBroken(true)} />
            <circle r={0.62} className={`fill-none ${ring} pointer-events-none`} strokeWidth={picked || token.isActive || token.targetable ? 0.12 : 0.06} strokeDasharray={token.targetable ? '0.2 0.12' : undefined} />
          </>
        ) : <text textAnchor='middle' dominantBaseline='central' className='fill-fg pointer-events-none' fontSize={0.45}>{token.name.slice(0, 2)}</text>}
        <text y={0.95} textAnchor='middle' className='fill-fg stroke-bg font-semibold pointer-events-none' fontSize={0.32} strokeWidth={0.16} strokeLinejoin='round' paintOrder='stroke'>{token.name}</text>
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
