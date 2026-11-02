'use client'
import { useState } from 'react'
import { RotateCcw, RotateCw, Save } from 'lucide-react'
import { Button, CatalogList, ConfirmDelete, ListButton, SectionLabel, Segment, Segmented, TextInput, selectClass } from '../ui'
import { BrushFace, BandLayers, BaseLayer, BrushSize, GroundGenerator, SurfaceRow, VeilFilter, ZoomButtons, cellAt } from '../BoardPanel'
import { useZoomPan } from '../../hooks/useZoomPan'
import { useBoardLook, type BoardLook } from '../../hooks/useBoardLook'
import { useBoardVeil } from '../../hooks/useBoardVeil'
import { useBoardMapEditor, useStructureEditor } from '../../hooks/useBoardMaps'
import { GROUND_BRUSHES, LIFT_LEAST, LIFT_MOST, LIGHT_LEVELS, PIECE_TURNS, STOREY_BRUSHES } from '../../domain/lists'
import type { TerrainBrush } from '../../domain/types'

type Editor = ReturnType<typeof useBoardMapEditor>

const TURN_LABEL = ['0°', '60°', '120°', '180°', '240°', '300°']

// The battle maps kept: the developer's, shared with everyone, and the
// profile's own. One is opened or begun anew, painted with the brushes the
// scene's board has, and kept under its name. Structures from the catalog are
// laid on it as pieces, each picked to be moved, turned or painted.
export function BoardMapsEditor() {
  const [storeyAt, setStoreyAt] = useState(0)
  const [chosen, setChosen] = useState<string | null>(null)
  const look = useBoardLook()
  const editor = useBoardMapEditor(storeyAt, chosen, look)
  return <KeptBoardEditor label='Battle maps' editor={editor} look={look} setStoreyAt={setStoreyAt} chosen={chosen} choose={(id) => { setChosen(id); setStoreyAt(0) }} />
}

// The structures kept, a house or a tree each, made the way a battle map is
// around the anchor at the board's middle.
export function StructuresEditor() {
  const [storeyAt, setStoreyAt] = useState(0)
  const look = useBoardLook()
  return <KeptBoardEditor label='Structures' editor={useStructureEditor(storeyAt, look)} look={look} setStoreyAt={setStoreyAt} chosen={null} choose={null} />
}

// What a click on the board does: paint (or lay the surface held), lay the
// structure held as a piece, pick the piece there, or move the piece picked.
type Tool = 'paint' | 'place' | 'pick' | 'move'

function KeptBoardEditor({ label, editor, look, setStoreyAt, chosen, choose }: { label: string, editor: Editor, look: BoardLook, setStoreyAt: (at: number) => void, chosen: string | null, choose: ((id: string | null) => void) | null }) {
  const { rows, view, map, openId, devServer, storeys, storey, piece, open, create, remove, save, setName, paint, light, laySurface, generateGround, resize, addStorey, removeStorey, setStorey } = editor
  const [brush, setBrush] = useState<TerrainBrush | null>('wall')
  const [laying, setLaying] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
  const [radius, setRadius] = useState(0)
  const [tool, setTool] = useState<Tool>('paint')
  const [held, setHeld] = useState<string | null>(null)
  const [turns, setTurns] = useState(0)
  const zoomPan = useZoomPan(view.viewBox)
  const veil = useBoardVeil(view)
  const opened = rows.find((r) => r.id === openId)
  const mine = opened ? !opened.shared || devServer : true
  const brushes = storey.level === null ? GROUND_BRUSHES : STOREY_BRUSHES
  const reset = () => { setStoreyAt(0); choose?.(null); setTool('paint') }

  const click = (e: React.MouseEvent) => {
    const cell = cellAt(e)
    if (!cell) return
    if (tool === 'place' && held) editor.placePiece(held, cell, turns)
    else if (tool === 'pick' && choose) { choose(editor.pieceAt(cell)); setTool('paint') }
    else if (tool === 'move' && piece) { editor.movePiece(piece, cell); setTool('paint') }
    else if (tool === 'paint' && laying) laySurface(cell, laying, frozen, radius)
    else if (tool === 'paint' && brush && brushes.includes(brush)) paint(cell, brush, radius)
  }

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label={label} groups={[{ label: null, rows }]} nameOf={(r) => r.name}
          beside={<Button size='xs' weight='subtle' tone='good' onClick={() => { reset(); create() }}>+ new</Button>}
          render={(r) => (
            <ListButton key={r.id} selected={r.id === openId} onClick={() => { reset(); open(r.id) }}>
              {r.name || '—'} <span className='text-muted'>· {r.shared ? 'shared' : 'yours'}</span>
            </ListButton>
          )} />
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        <div className='flex flex-row flex-wrap items-center gap-2'>
          <TextInput className='w-64' aria-label={`${label} name`} placeholder='name it' value={map.name} onChange={(e) => setName(e.target.value)} />
          {(['q', 'r', 's'] as const).map((axis) => (
            <label key={axis} className='flex flex-row items-center gap-1 text-xs'>{axis}
              <TextInput className='w-16' type='number' min={1} max={30} aria-label={`extent ${axis}`} value={map.extent[axis]} onChange={(e) => resize({ ...map.extent, [axis]: Number(e.target.value) })} />
            </label>
          ))}
          <span className='grow' />
          <Button size='xs' weight='solid' tone='accent' icon={Save} disabled={!map.name.trim() || !mine} onClick={() => save(opened ? opened.shared : false)}>{opened?.shared ? 'save for all' : 'save mine'}</Button>
          {!opened && devServer ? <Button size='xs' disabled={!map.name.trim()} onClick={() => save(true)}>save for all</Button> : null}
          {opened ? <Button size='xs' title='open a copy to save under another name' onClick={editor.duplicate}>duplicate</Button> : null}
          {opened && mine ? <ConfirmDelete remove={() => remove(opened.id)} /> : null}
        </div>
        {label === 'Structures' ? <ArtRow art={map.art} setArt={editor.setArt} /> : null}
        {choose ? <PieceRow editor={editor} tool={tool} setTool={setTool} held={held} setHeld={setHeld} turns={turns} setTurns={setTurns} choose={choose} /> : null}
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>{piece ? `storey of ${editor.pieces.find((p) => p.id === chosen)?.name ?? 'the piece'}` : 'storey'}</SectionLabel>
          <Segmented label='storey'>
            {storeys.map((s, at) => <Segment key={s.level ?? 'ground'} selected={s.level === storey.level} onClick={() => setStoreyAt(at)}>{s.label}</Segment>)}
          </Segmented>
          <Button size='xs' weight='subtle' tone='good' onClick={() => { addStorey(); setStoreyAt(storeys.length) }}>+ storey</Button>
          {storey.level !== null ?
            <>
              <label className='flex flex-row items-center gap-1 text-xs'>floor
                <TextInput className='w-16' type='number' step={0.5} aria-label='storey floor' value={storey.floor} onChange={(e) => setStorey(storey.level!, { floor: Number(e.target.value) })} />
              </label>
              <label className='flex flex-row items-center gap-1 text-xs'>height
                <TextInput className='w-16' type='number' min={0} step={0.5} aria-label='storey height' value={storey.height} onChange={(e) => setStorey(storey.level!, { height: Number(e.target.value) })} />
              </label>
              <ConfirmDelete remove={() => { removeStorey(storey.level!); setStoreyAt(0) }} />
            </>
            : null}
        </div>
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>paint</SectionLabel>
          {brushes.map((b) => <Button key={b} size='xs' selected={tool === 'paint' && brush === b} onClick={() => { setBrush(b); setLaying(null); setTool('paint') }}><BrushFace brush={b} icons={editor.brushIcons} /></Button>)}
        </div>
        <BrushSize radius={radius} setRadius={setRadius} />
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>light</SectionLabel>
          <Segmented label='light'>
            {LIGHT_LEVELS.map((l) => <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
          </Segmented>
          <span className='grow' />
          <Button size='xs' selected={look.front} aria-label='front view' title={look.front ? 'seen from the front: higher ground lifted up the screen. Click for the view from above' : 'seen from above. Click for the view from the front'} onClick={() => look.setFront(!look.front)}>{look.front ? 'front' : 'top'}</Button>
          {look.front ? <TextInput className='w-14' type='number' min={LIFT_LEAST} max={LIFT_MOST} step={0.05} aria-label='lift per metre' title='how far a metre of height lifts the ground up the screen' value={look.lift} onChange={(e) => look.setLift(Number(e.target.value))} /> : null}
          <ZoomButtons zoomPan={zoomPan} />
        </div>
        <SurfaceRow surfaces={view.surfaces} laying={tool === 'paint' ? laying : null} frozen={frozen} freeze={setFrozen} lay={(name) => { setLaying(laying === name ? null : name); setFrozen(null); setBrush(null); setTool('paint') }} />
        {storey.level === null && !piece ? <GroundGenerator surfaces={view.surfaces} generate={generateGround} /> : null}
        <svg {...zoomPan.svg} className='w-full max-h-[60vh] select-none touch-none' role='img' aria-label={label} onClick={click}>
          <defs><VeilFilter /></defs>
          {Array.from({ length: view.bands }, (_, band) => <BandLayers key={band} view={view} band={band} veiled={veil.veiled} />)}
          <BaseLayer view={view} lit={veil.lit} setLit={veil.setLit} />
        </svg>
      </div>
    </div>
  )
}

// The one picture a structure is drawn with from the front: a path under
// `public/`, how many board units across it stands and how many metres tall,
// and how far it is moved from the anchor. Each storey shows its slice.
function ArtRow({ art, setArt }: { art: Editor['map']['art'], setArt: Editor['setArt'] }) {
  const field = (name: 'width' | 'height' | 'offsetX' | 'offsetY', title: string) => (
    <label key={name} className='flex flex-row items-center gap-1 text-xs'>{title}
      <TextInput className='w-16' type='number' step={0.5} aria-label={`picture ${title}`} value={art?.[name] ?? 0} onChange={(e) => setArt({ [name]: Number(e.target.value) })} />
    </label>
  )
  return (
    <div className='flex flex-row flex-wrap gap-2 items-center'>
      <SectionLabel>picture</SectionLabel>
      <input type='checkbox' aria-label='structure has a picture' checked={art !== null} onChange={(e) => setArt(e.target.checked ? {} : null)} />
      {art ?
        <>
          <TextInput className='w-64' aria-label='picture path' placeholder='/structures/tree.png' value={art.src} onChange={(e) => setArt({ src: e.target.value })} />
          {field('width', 'across')}
          {field('height', 'metres tall')}
          {field('offsetX', 'shift x')}
          {field('offsetY', 'shift y')}
        </>
        : <span className='text-xs text-muted'>none</span>}
    </div>
  )
}

// The structures of the catalog to lay on the map, and the pieces laid: one
// picked is painted on by the brushes instead of the map's own ground, and is
// turned, moved, kept as a structure of its own or taken away.
function PieceRow({ editor, tool, setTool, held, setHeld, turns, setTurns, choose }: { editor: Editor, tool: Tool, setTool: (tool: Tool) => void, held: string | null, setHeld: (id: string | null) => void, turns: number, setTurns: (turns: number) => void, choose: (id: string | null) => void }) {
  const { structures, pieces, piece } = editor
  const name = pieces.find((p) => p.id === piece)?.name
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>structures</SectionLabel>
        <select aria-label='structure to lay' className={selectClass} value={held ?? ''} onChange={(e) => { setHeld(e.target.value || null); setTool(e.target.value ? 'place' : 'paint') }}>
          <option value=''>pick a structure</option>
          {structures.map((s) => <option key={s.id} value={s.id}>{s.name}{s.shared ? '' : ' (yours)'}</option>)}
        </select>
        <Segmented label='turned'>
          {PIECE_TURNS.map((t) => <Segment key={t} selected={turns === t} onClick={() => setTurns(t)}>{TURN_LABEL[t]}</Segment>)}
        </Segmented>
        <Button size='xs' selected={tool === 'place'} disabled={!held} title={held ? 'click a cell to lay the structure with its anchor there' : 'pick a structure first'} onClick={() => setTool(tool === 'place' ? 'paint' : 'place')}>lay</Button>
        <Button size='xs' selected={tool === 'pick'} disabled={pieces.length === 0} title='click a piece on the map to pick it' onClick={() => setTool(tool === 'pick' ? 'paint' : 'pick')}>pick</Button>
        {pieces.map((p) => <Button key={p.id} size='xs' weight='subtle' selected={p.id === piece} onClick={() => choose(p.id === piece ? null : p.id)}>{p.name}</Button>)}
      </div>
      {piece ?
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>{`editing ${name}`}</SectionLabel>
          <Button size='xs' icon={RotateCcw} aria-label='turn left' onClick={() => editor.turnPiece(piece, 1)} />
          <Button size='xs' icon={RotateCw} aria-label='turn right' onClick={() => editor.turnPiece(piece, -1)} />
          <Button size='xs' selected={tool === 'move'} title='click a cell to move the anchor there' onClick={() => setTool(tool === 'move' ? 'paint' : 'move')}>move</Button>
          <Button size='xs' onClick={() => editor.savePiece(piece)}>save as structure</Button>
          <ConfirmDelete remove={() => { editor.removePiece(piece); choose(null) }} />
          <Button size='xs' weight='ghost' onClick={() => choose(null)}>done</Button>
        </div>
        : null}
    </div>
  )
}
