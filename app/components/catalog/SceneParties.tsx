'use client'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { CatalogDrawer } from '../RunParts'
import { Button, IconButton, NumberInput, SectionLabel, TextInput, selectClass } from '../ui'
import { SCENE_PLAYERS, useScenePresetBoard, useScenePresetDraft } from '../../hooks/useScenePresets'
import { useBoardCamera, useCellAt, type BoardCamera } from '../../hooks/useBoardCanvas'
import type { BoardView } from '../../domain/scene/projections/boardView'
import type { Coord } from '../../domain/scene/types'
import { useBoardVeil } from '../../hooks/useBoardVeil'
import { BoardCanvas } from '../BoardCanvas'
import { BrushSize, ZoomButtons } from '../BoardPanel'
import { SPAWN_SWATCH } from '../spawnSwatch'

// The parties a prepared scene brings into its fight, each the enemy of
// every other: a card each, made of catalog characters picked from the
// catalog opened beside the cards, so many copies of each and who plays them.
export function SceneParties({ value, onChange }: { value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void }) {
  const { parties, addParty, renameParty, removeParty, setVisitor, addMember, setCount, setPlayer, removeMember } = useScenePresetDraft(value, onChange)
  const [adding, setAdding] = useState<number | null>(null)
  const open = adding !== null && adding < parties.length ? adding : null
  const remove = (party: number) => { setAdding(null); removeParty(party) }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>parties</SectionLabel>
        <Button size='xs' weight='subtle' tone='good' icon={Plus} onClick={addParty}>create party</Button>
      </div>
      {parties.length === 0 ? <span className='text-xs text-muted'>No party yet: whoever meets the scene would fight nobody.</span> : null}
      <div className='flex flex-row gap-3 items-start'>
        {open !== null
          ? <CatalogDrawer label={`adding to ${parties[open].name || `party ${open + 1}`}`} close={() => setAdding(null)} onSelect={(c) => addMember(open, c)} />
          : null}
        <div className='flex flex-row flex-wrap gap-2 flex-1 min-w-0 items-start'>
          {parties.map((party, p) => (
            <div key={p} className={`flex flex-col gap-1 p-2 rounded border w-80 ${open === p ? 'border-accent' : 'border-line'}`}>
              <div className='flex flex-row items-center gap-1'>
                <TextInput className='text-sm grow min-w-0' aria-label={`party ${p + 1} name`} placeholder={`party ${p + 1}`}
                  value={party.name} onChange={(e) => renameParty(p, e.target.value)} />
                <IconButton icon={X} tone='bad' aria-label={`remove party ${p + 1}`} onClick={() => remove(p)} />
              </div>
              <div className='flex flex-row flex-wrap items-center gap-2 text-xs'>
                <span className='flex flex-row items-center gap-1 text-muted' title='where the party is placed before the fight starts: painted on the battle map below'>
                  <span className={`inline-block w-3 h-3 rounded-sm border ${SPAWN_SWATCH[p + 1] ?? SPAWN_SWATCH[1]}`} />
                  {party.spawn.length > 0 ? `placed in ${party.spawn.length} cells` : 'placed anywhere'}
                </span>
                <label className='flex flex-row items-center gap-1' title="the demo's visitor fills this party and plays it; its members are the party offered ready-made">
                  <input type='checkbox' aria-label={`party ${p + 1} is the demo visitor's`} checked={party.visitor} onChange={(e) => setVisitor(p, e.target.checked)} />
                  the demo visitor&apos;s
                </label>
              </div>
              {party.members.map((member, m) => (
                <div key={`${member.key}-${m}`} className='flex flex-row items-center gap-1'>
                  <span className='text-sm grow min-w-0 truncate' title={member.key}>{member.key || '(no character)'}</span>
                  <span className='text-xs text-muted'>×</span>
                  <NumberInput className='w-10 text-sm' aria-label={`${member.key} count`} min={1}
                    value={member.count} onChange={(e) => setCount(p, m, Number(e.target.value))} />
                  <select aria-label={`${member.key} played by`} className={selectClass} title='who plays them'
                    value={member.player ?? ''} onChange={(e) => setPlayer(p, m, e.target.value || null)}>
                    <option value=''>the GM</option>
                    {SCENE_PLAYERS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    {member.player && !SCENE_PLAYERS.some((b) => b.id === member.player) ? <option value={member.player}>{member.player}</option> : null}
                  </select>
                  <IconButton icon={X} aria-label={`remove ${member.key}`} onClick={() => removeMember(p, m)} />
                </div>
              ))}
              <Button size='xs' className='self-start' aria-pressed={open === p} selected={open === p}
                onClick={() => setAdding(open === p ? null : p)}>add characters</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// The scene's spawn areas, painted over its battle map: the party whose area
// the brush paints, or none to take cells out of every area. A party with no
// cells is placed anywhere.
export function SceneSpawns({ value, onChange }: { value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void }) {
  const { parties } = useScenePresetDraft(value, onChange)
  const { view, paint } = useScenePresetBoard(value, onChange)
  const [party, setParty] = useState<number | null>(0)
  const [radius, setRadius] = useState(0)
  const camera = useBoardCamera()
  if (!view) return <span className='text-xs text-muted'>Name a shared battle map for the scene to paint where its parties are placed.</span>
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap items-center gap-1'>
        <SectionLabel>spawn areas</SectionLabel>
        {parties.map((p, i) => (
          <Button key={i} size='xs' selected={party === i} title={`paint where ${p.name || `party ${i + 1}`} is placed before the fight starts`} onClick={() => setParty(i)}>
            <span className={`inline-block w-3 h-3 mr-1 rounded-sm border align-middle ${SPAWN_SWATCH[i + 1] ?? SPAWN_SWATCH[1]}`} />{p.name || `party ${i + 1}`}
          </Button>
        ))}
        <Button size='xs' selected={party === null} title='take cells out of every area' onClick={() => setParty(null)}>erase</Button>
        <span className='grow' />
        <ZoomButtons camera={camera} />
      </div>
      <BrushSize radius={radius} setRadius={setRadius} />
      <SpawnBoard view={view} camera={camera} onCell={(cell) => paint(party, cell, radius)} />
    </div>
  )
}

function SpawnBoard({ view, camera, onCell }: { view: BoardView, camera: BoardCamera, onCell: (cell: Coord) => void }) {
  const cellAt = useCellAt()
  const veil = useBoardVeil(view)
  return <BoardCanvas className='w-full h-[50vh] shrink-0' label='scene board' view={view} veiled={veil.veiled} camera={camera} cellAt={cellAt} onCell={onCell} />
}
