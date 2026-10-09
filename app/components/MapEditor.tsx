'use client'

import { useState } from 'react'
import { Button, ListButton, NumberInput, SectionLabel, TextInput, selectClass } from './ui'
import { useMapEditor } from '../hooks/useMap'
import { EVENT_TYPES, TERRAIN_TAGS, type EventOwner } from '../domain/campaign/types'
import { knowledges_list } from '../domain/lists'
import type { EventView } from '../domain/campaign/projections/map'

const OUTCOMES = ['critical', 'hit', 'graze', 'miss'] as const

// survival.tex "Creating the point crawl": the saved maps on the left, the
// map being made on the right — its terrains, its nodes and the paths
// between them, and the events on both.
export function MapEditor() {
  return (
    <div className='grid grid-cols-12 gap-2 py-2 text-left text-sm'>
      <MapList />
      <div className='col-span-10 flex flex-col gap-4 max-h-[85vh] overflow-y-auto pr-2'>
        <MapHeader />
        <Terrains />
        <Nodes />
        <Connections />
      </div>
      <datalist id='knowledges'>
        {knowledges_list.map((k) => <option key={k} value={k} />)}
      </datalist>
    </div>
  )
}

function MapList() {
  const { view, maps, open, create } = useMapEditor()
  return (
    <div className='col-span-2 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
      <div className='flex flex-row items-center gap-1'>
        <SectionLabel>Maps</SectionLabel>
        <span className='grow' />
        <Button size='xs' variant='good' onClick={create}>+ new</Button>
      </div>
      {maps.map((name) => (
        <ListButton key={name} selected={view.name === name} onClick={() => open(name)}>{name}</ListButton>
      ))}
    </div>
  )
}

function MapHeader() {
  const { view, maps, setName, save, remove } = useMapEditor()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className='flex flex-row flex-wrap gap-2 items-center'>
      <TextInput aria-label='map name' placeholder='map name' value={view.name} onChange={(e) => setName(e.target.value)} />
      <Button variant='good' onClick={save}>save</Button>
      {maps.includes(view.name) ?
        confirm ?
          <>
            <Button variant='bad' onClick={() => { setConfirm(false); remove(view.name) }}>delete {view.name}</Button>
            <Button variant='ghost' onClick={() => setConfirm(false)}>keep</Button>
          </>
          : <Button variant='ghost' onClick={() => setConfirm(true)}>delete…</Button>
        : null}
    </div>
  )
}

function Terrains() {
  const { view, addTerrain, setTerrain, toggleTag, removeTerrain } = useMapEditor()
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>Terrains</SectionLabel>
        <Button size='xs' variant='ghost' onClick={addTerrain}>+ terrain</Button>
      </div>
      {view.terrains.map((t) => (
        <div key={t.id} className='flex flex-row flex-wrap gap-1.5 items-center border-t border-line pt-1'>
          <TextInput className='w-32' aria-label='terrain name' value={t.name} onChange={(e) => setTerrain(t.id, { name: e.target.value })} />
          <span className='text-xs text-muted'>exposure</span>
          <NumberInput className='w-10' aria-label={`${t.name} exposure`} value={t.exposure} onChange={(e) => setTerrain(t.id, { exposure: parseInt(e.target.value) || 0 })} />
          <span className='text-xs text-muted'>shelter DL</span>
          <NumberInput className='w-10' aria-label={`${t.name} shelter DL`} value={t.shelterDL} onChange={(e) => setTerrain(t.id, { shelterDL: parseInt(e.target.value) || 0 })} />
          <span className='text-xs text-muted'>wear</span>
          <NumberInput className='w-10' aria-label={`${t.name} wear`} value={t.wear} onChange={(e) => setTerrain(t.id, { wear: parseInt(e.target.value) || 0 })} />
          <span className='text-xs text-muted'>knowledge</span>
          <TextInput className='w-28' list='knowledges' aria-label={`${t.name} knowledge`} value={t.knowledge} onChange={(e) => setTerrain(t.id, { knowledge: e.target.value })} />
          {TERRAIN_TAGS.map((tag) => (
            <Button key={tag} size='xs' variant={t.tags.includes(tag) ? 'primary' : 'ghost'} onClick={() => toggleTag(t.id, tag)}>{tag}</Button>
          ))}
          <Button aria-label={`remove ${t.name}`} variant='ghost' onClick={() => removeTerrain(t.id)}>×</Button>
        </div>
      ))}
    </div>
  )
}

function Nodes() {
  const { view, addNode, setNode, removeNode, addEvent } = useMapEditor()
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>Nodes</SectionLabel>
        <Button size='xs' variant='ghost' onClick={addNode}>+ node</Button>
      </div>
      {view.nodes.map((n) => (
        <div key={n.id} className='flex flex-col gap-1 border-t border-line pt-1'>
          <div className='flex flex-row flex-wrap gap-1.5 items-center'>
            <TextInput className='w-40' aria-label='node name' value={n.name} onChange={(e) => setNode(n.id, { name: e.target.value })} />
            <select aria-label={`${n.name} terrain`} className={selectClass} value={n.terrain ?? ''} onChange={(e) => setNode(n.id, { terrain: e.target.value || null })}>
              <option value=''>no terrain</option>
              {view.terrains.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'node', id: n.id })}>+ event</Button>
            <Button aria-label={`remove ${n.name}`} variant='ghost' onClick={() => removeNode(n.id)}>×</Button>
          </div>
          {n.events.map((e) => <EventEditor key={e.id} owner={{ kind: 'node', id: n.id }} event={e} />)}
        </div>
      ))}
    </div>
  )
}

function Connections() {
  const { view, addConnection, setConnection, removeConnection, addEvent } = useMapEditor()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap items-center gap-2'>
        <SectionLabel>Paths</SectionLabel>
        <select aria-label='path from' className={selectClass} value={a} onChange={(e) => setA(e.target.value)}>
          <option value=''>from…</option>
          {view.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <select aria-label='path to' className={selectClass} value={b} onChange={(e) => setB(e.target.value)}>
          <option value=''>to…</option>
          {view.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <Button size='xs' variant='ghost' disabled={!a || !b || a === b} onClick={() => addConnection(a, b)}>+ path</Button>
      </div>
      {view.connections.map((c) => (
        <div key={c.id} className='flex flex-col gap-1 border-t border-line pt-1'>
          <div className='flex flex-row flex-wrap gap-1.5 items-center'>
            <span className='text-sm'>{c.name}</span>
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${c.name} DL`} value={c.DL} onChange={(e) => setConnection(c.id, { DL: parseInt(e.target.value) || 0 })} />
            <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'connection', id: c.id })}>+ event</Button>
            <Button aria-label={`remove ${c.name}`} variant='ghost' onClick={() => removeConnection(c.id)}>×</Button>
          </div>
          {c.events.map((e) => <EventEditor key={e.id} owner={{ kind: 'connection', id: c.id }} event={e} />)}
        </div>
      ))}
    </div>
  )
}

// survival.tex "Events": an event, its DL to be found, what it needs known,
// and what it comes to at each degree.
function EventEditor({ owner, event }: { owner: EventOwner, event: EventView }) {
  const { setEvent, toggleType, setEnabler, removeEvent } = useMapEditor()
  return (
    <div className='flex flex-col gap-1 ml-4 pl-2 border-l border-line'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='event name' value={event.name} onChange={(e) => setEvent(owner, event.id, { name: e.target.value })} />
        <span className='text-xs text-muted'>DL</span>
        <NumberInput className='w-10' aria-label={`${event.name} DL`} value={event.DL} onChange={(e) => setEvent(owner, event.id, { DL: parseInt(e.target.value) || 0 })} />
        {EVENT_TYPES.map((type) => (
          <Button key={type} size='xs' variant={event.types.includes(type) ? 'primary' : 'ghost'} onClick={() => toggleType(owner, event.id, type)}>{type}</Button>
        ))}
        <span className='text-xs text-muted'>needs</span>
        <TextInput className='w-28' list='knowledges' aria-label={`${event.name} enabler`} placeholder='knowledge' value={event.enabler?.knowledge ?? ''}
          onChange={(e) => setEnabler(owner, event.id, e.target.value, event.enabler?.level ?? 1)} />
        {event.enabler ?
          <NumberInput className='w-10' aria-label={`${event.name} enabler level`} value={event.enabler.level}
            onChange={(e) => setEnabler(owner, event.id, event.enabler?.knowledge ?? '', parseInt(e.target.value) || 0)} />
          : null}
        <Button aria-label={`remove ${event.name}`} variant='ghost' onClick={() => removeEvent(owner, event.id)}>×</Button>
      </div>
      {OUTCOMES.map((degree) => (
        <div key={degree} className='flex flex-row gap-1.5 items-center'>
          <span className='text-xs text-muted w-14'>{degree}</span>
          <TextInput className='grow' aria-label={`${event.name} ${degree}`} value={event.outcomes[degree]}
            onChange={(e) => setEvent(owner, event.id, { outcomes: { ...event.outcomes, [degree]: e.target.value } })} />
        </div>
      ))}
    </div>
  )
}
