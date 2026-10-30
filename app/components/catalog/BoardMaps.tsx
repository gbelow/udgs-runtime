'use client'
import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button, CatalogList, ConfirmDelete, ListButton, SectionLabel, Segment, Segmented, TextInput } from '../ui'
import { BRUSH_LABEL, BrushSize, Cell, GroundGenerator, RidgeLayer, ShadeLayer, SurfaceLayer, SurfaceRow, ZoomButtons, cellAt } from '../BoardPanel'
import { useZoomPan } from '../../hooks/useZoomPan'
import { useBoardMapEditor, useStructureEditor } from '../../hooks/useBoardMaps'
import { GROUND_BRUSHES, LIGHT_LEVELS, STOREY_BRUSHES } from '../../domain/lists'
import type { TerrainBrush } from '../../domain/types'

// The battle maps kept: the developer's, shared with everyone, and the
// profile's own. One is opened or begun anew, painted with the brushes the
// scene's board has, and kept under its name.
export function BoardMapsEditor() {
  const [level, setLevel] = useState<number | null>(null)
  return <KeptBoardEditor label='Battle maps' editor={useBoardMapEditor(level)} level={level} setLevel={setLevel} />
}

// The structures kept, a house or a tree each, made the way a battle map is
// around the anchor at the board's middle.
export function StructuresEditor() {
  const [level, setLevel] = useState<number | null>(null)
  return <KeptBoardEditor label='Structures' editor={useStructureEditor(level)} level={level} setLevel={setLevel} />
}

function KeptBoardEditor({ label, editor, level, setLevel }: { label: string, editor: ReturnType<typeof useBoardMapEditor>, level: number | null, setLevel: (level: number | null) => void }) {
  const { rows, view, map, openId, devServer, storeys, open, create, remove, save, setName, paint, light, laySurface, generateGround, resize, addStorey, removeStorey, setStorey } = editor
  const [brush, setBrush] = useState<TerrainBrush | null>('wall')
  const [laying, setLaying] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
  const [radius, setRadius] = useState(0)
  const zoomPan = useZoomPan(view.viewBox)
  const opened = rows.find((r) => r.id === openId)
  const mine = opened ? !opened.shared || devServer : true
  const storey = storeys.find((s) => s.level === level) ?? storeys[0]
  const brushes = storey.level === null ? GROUND_BRUSHES : STOREY_BRUSHES

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label={label} groups={[{ label: null, rows }]} nameOf={(r) => r.name}
          beside={<Button size='xs' weight='subtle' tone='good' onClick={() => { setLevel(null); create() }}>+ new</Button>}
          render={(r) => (
            <ListButton key={r.id} selected={r.id === openId} onClick={() => { setLevel(null); open(r.id) }}>
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
          {opened && mine ? <ConfirmDelete remove={() => remove(opened.id)} /> : null}
        </div>
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>storey</SectionLabel>
          <Segmented label='storey'>
            {storeys.map((s) => <Segment key={s.level ?? 'ground'} selected={s.level === storey.level} onClick={() => setLevel(s.level)}>{s.label}</Segment>)}
          </Segmented>
          <Button size='xs' weight='subtle' tone='good' onClick={() => { addStorey(); setLevel(map.levels.length) }}>+ storey</Button>
          {storey.level !== null ?
            <>
              <label className='flex flex-row items-center gap-1 text-xs'>floor
                <TextInput className='w-16' type='number' step={0.5} aria-label='storey floor' value={storey.floor} onChange={(e) => setStorey(storey.level!, { floor: Number(e.target.value) })} />
              </label>
              <label className='flex flex-row items-center gap-1 text-xs'>height
                <TextInput className='w-16' type='number' min={0} step={0.5} aria-label='storey height' value={storey.height} onChange={(e) => setStorey(storey.level!, { height: Number(e.target.value) })} />
              </label>
              <ConfirmDelete remove={() => { removeStorey(storey.level!); setLevel(null) }} />
            </>
            : null}
        </div>
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>paint</SectionLabel>
          {brushes.map((b) => <Button key={b} size='xs' selected={brush === b} onClick={() => { setBrush(b); setLaying(null) }}>{BRUSH_LABEL[b]}</Button>)}
        </div>
        <BrushSize radius={radius} setRadius={setRadius} />
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>light</SectionLabel>
          <Segmented label='light'>
            {LIGHT_LEVELS.map((l) => <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
          </Segmented>
          <span className='grow' />
          <ZoomButtons zoomPan={zoomPan} />
        </div>
        <SurfaceRow surfaces={view.surfaces} laying={laying} frozen={frozen} freeze={setFrozen} lay={(name) => { setLaying(laying === name ? null : name); setFrozen(null); setBrush(null) }} />
        {storey.level === null ? <GroundGenerator surfaces={view.surfaces} generate={generateGround} /> : null}
        <svg {...zoomPan.svg} className='w-full max-h-[60vh] select-none touch-none' role='img' aria-label={label}
          onClick={(e) => { const cell = cellAt(e); if (!cell) return; if (laying) laySurface(cell, laying, frozen, radius); else if (brush && brushes.includes(brush)) paint(cell, brush, radius) }}>
          <SurfaceLayer view={view} />
          {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} />)}
          <RidgeLayer view={view} />
          <ShadeLayer view={view} />
        </svg>
      </div>
    </div>
  )
}
