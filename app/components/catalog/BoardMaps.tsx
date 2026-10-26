'use client'
import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button, CatalogList, ConfirmDelete, ListButton, SectionLabel, Segment, Segmented, TextInput } from '../ui'
import { BRUSH_LABEL, Cell, SurfaceLayer, SurfaceRow, ZoomButtons, cellAt } from '../BoardPanel'
import { useZoomPan } from '../../hooks/useZoomPan'
import { useBoardMapEditor } from '../../hooks/useBoardMaps'
import { LIGHT_LEVELS, TERRAIN_BRUSHES } from '../../domain/lists'
import type { TerrainBrush } from '../../domain/types'

// The battle maps kept: the developer's, shared with everyone, and the
// profile's own. One is opened or begun anew, painted with the brushes the
// scene's board has, and kept under its name.
export function BoardMapsEditor() {
  const { rows, view, map, openId, devServer, open, create, remove, save, setName, paint, light, surface, laySurface, resize } = useBoardMapEditor()
  const [brush, setBrush] = useState<TerrainBrush | null>('wall')
  const [laying, setLaying] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<string | null>(null)
  const zoomPan = useZoomPan(view.viewBox)
  const opened = rows.find((r) => r.id === openId)
  const mine = opened ? !opened.shared || devServer : true

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label='Battle maps' groups={[{ label: null, rows }]} nameOf={(r) => r.name}
          beside={<Button size='xs' weight='subtle' tone='good' onClick={create}>+ new</Button>}
          render={(r) => (
            <ListButton key={r.id} selected={r.id === openId} onClick={() => open(r.id)}>
              {r.name || '—'} <span className='text-muted'>· {r.shared ? 'shared' : 'yours'}</span>
            </ListButton>
          )} />
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        <div className='flex flex-row flex-wrap items-center gap-2'>
          <TextInput className='w-64' aria-label='battle map name' placeholder='name it' value={map.name} onChange={(e) => setName(e.target.value)} />
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
          <SectionLabel>paint</SectionLabel>
          {TERRAIN_BRUSHES.map((b) => <Button key={b} size='xs' selected={brush === b} onClick={() => { setBrush(b); setLaying(null) }}>{BRUSH_LABEL[b]}</Button>)}
        </div>
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>light</SectionLabel>
          <Segmented label='light'>
            {LIGHT_LEVELS.map((l) => <Segment key={l} selected={view.light === l} onClick={() => light(l)}>{l}</Segment>)}
          </Segmented>
          <span className='grow' />
          <ZoomButtons zoomPan={zoomPan} />
        </div>
        <SurfaceRow surfaces={view.surfaces} base={view.surface} setBase={surface} laying={laying} frozen={frozen} freeze={setFrozen} lay={(name) => { setLaying(laying === name ? null : name); setFrozen(null); setBrush(null) }} />
        <svg {...zoomPan.svg} className='w-full max-h-[60vh] select-none touch-none' role='img' aria-label='battle map'
          onClick={(e) => { const cell = cellAt(e); if (!cell) return; if (laying) laySurface(cell, laying, frozen); else if (brush) paint(cell, brush) }}>
          <SurfaceLayer view={view} />
          {view.cells.map((c) => <Cell key={c.key} cell={c} hex={view.hex} />)}
        </svg>
      </div>
    </div>
  )
}
