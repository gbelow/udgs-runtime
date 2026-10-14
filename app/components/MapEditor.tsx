'use client'

import { useState, type ReactNode } from 'react'
import { Button, ListButton, NumberInput, SectionLabel, TextInput, selectClass } from './ui'
import { useMapEditor } from '../hooks/useMap'
import { EVENT_TYPES, TERRAIN_TAGS, WAYS, type EventOwner, type TerrainValues, type Way } from '../domain/campaign/types'
import { knowledges_list } from '../domain/lists'
import type { EventView, NodeEditorView } from '../domain/campaign/projections/map'

const OUTCOMES = ['critical', 'hit', 'graze', 'miss'] as const
const WEAR_KEYS = ['IL', 'exhaustion', 'hunger', 'thirst'] as const

// survival.tex "Creating the point crawl": the saved maps on the left, the
// map being made on the right — its nodes, each made of a terrain from the
// catalog, the paths between them, and the events on both.
export function MapEditor() {
  return (
    <div className='grid grid-cols-12 gap-2 py-2 text-left text-sm'>
      <MapList />
      <div className='col-span-10 flex flex-col gap-4 max-h-[85vh] overflow-y-auto pr-2'>
        <MapHeader />
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

function Nodes() {
  const { view, addNode, setNode, toggleSettlement, setSettlementLiving, removeNode, addEvent } = useMapEditor()
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
              {n.terrain && !view.presets.includes(n.terrain) ? <option value={n.terrain}>{n.terrain} (not in the catalog)</option> : null}
              {view.presets.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className='text-xs text-muted flex items-center gap-1'>
              <input type='checkbox' aria-label={`${n.name} settlement`} checked={n.settlement !== null} onChange={() => toggleSettlement(n.id)} />settlement
            </label>
            {n.settlement ?
              <>
                <span className='text-xs text-muted' title='story.tex "Cost of Living": the cost of living changes from town to town'>living cost ×</span>
                <NumberInput className='w-12' step={0.1} aria-label={`${n.name} living cost`} value={n.settlement.living} onChange={(e) => setSettlementLiving(n.id, parseFloat(e.target.value) || 0)} />
              </>
              : null}
            <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'node', id: n.id })}>+ event</Button>
            <Button aria-label={`remove ${n.name}`} variant='ghost' onClick={() => removeNode(n.id)}>×</Button>
          </div>
          <NodeTerrain node={n} />
          {n.events.map((e) => <EventEditor key={e.id} owner={{ kind: 'node', id: n.id }} event={e} />)}
        </div>
      ))}
    </div>
  )
}

// What the node is made of: its terrain's values, the ones the node changed
// marked, each to be taken from the terrain again.
function NodeTerrain({ node }: { node: NodeEditorView }) {
  const { customizeNode, customizeWear, toggleTag, resetValue } = useMapEditor()
  const values = node.values
  if (!values) return null
  const label = (key: keyof TerrainValues, text: string) => (
    node.custom.includes(key) ?
      <button type='button' className='text-xs text-accent' title='changed on this node; click to take it from the terrain' onClick={() => resetValue(node.id, key)}>{text} ↺</button>
      : <span className='text-xs text-muted'>{text}</span>
  )
  return (
    <div className='flex flex-row flex-wrap gap-1.5 items-center ml-4'>
      {label('exposure', 'exposure')}
      <NumberInput className='w-10' aria-label={`${node.name} exposure`} value={values.exposure} onChange={(e) => customizeNode(node.id, { exposure: parseInt(e.target.value) || 0 })} />
      {label('shelterDL', 'shelter DL')}
      <NumberInput className='w-10' aria-label={`${node.name} shelter DL`} value={values.shelterDL} onChange={(e) => customizeNode(node.id, { shelterDL: parseInt(e.target.value) || 0 })} />
      {label('wear', 'extra wear')}
      {WEAR_KEYS.map((key) => (
        <span key={key} className='flex flex-row gap-1 items-center'>
          <span className='text-xs text-muted'>{key}</span>
          <NumberInput className='w-10' aria-label={`${node.name} wear ${key}`} value={values.wear[key]} onChange={(e) => customizeWear(node.id, { [key]: parseInt(e.target.value) || 0 })} />
        </span>
      ))}
      {label('knowledge', 'knowledge')}
      <TextInput className='w-28' list='knowledges' aria-label={`${node.name} knowledge`} value={values.knowledge} onChange={(e) => customizeNode(node.id, { knowledge: e.target.value })} />
      {label('tags', 'tags')}
      {TERRAIN_TAGS.map((tag) => (
        <Button key={tag} size='xs' variant='ghost' selected={values.tags.includes(tag)} onClick={() => toggleTag(node.id, tag)}>{tag}</Button>
      ))}
    </div>
  )
}

function Connections() {
  const { view, addConnection, setConnection, removeConnection, addEvent, setWay } = useMapEditor()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [DL, setDL] = useState(0)
  const [backDL, setBackDL] = useState(0)
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
        <span className='text-xs text-muted'>DL there</span>
        <NumberInput className='w-10' aria-label='path DL there' value={DL} onChange={(e) => setDL(parseInt(e.target.value) || 0)} />
        <span className='text-xs text-muted'>DL back</span>
        <NumberInput className='w-10' aria-label='path DL back' value={backDL} onChange={(e) => setBackDL(parseInt(e.target.value) || 0)} />
        <Button size='xs' variant='ghost' disabled={!a || !b || a === b} onClick={() => addConnection(a, b, DL, backDL)}>+ path</Button>
      </div>
      {view.connections.map((c) => (
        <div key={c.id} className='flex flex-col gap-1 border-t border-line pt-1'>
          <div className='flex flex-row flex-wrap gap-1.5 items-center'>
            <span className='text-sm'>{c.aName} → {c.bName}</span>
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${c.aName} to ${c.bName} DL`} value={c.DL} onChange={(e) => setConnection(c.id, { DL: parseInt(e.target.value) || 0 })} />
            <span className='text-sm'>· {c.bName} → {c.aName}</span>
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${c.bName} to ${c.aName} DL`} value={c.backDL} onChange={(e) => setConnection(c.id, { backDL: parseInt(e.target.value) || 0 })} />
            <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'connection', id: c.id })}>+ event</Button>
            <Button aria-label={`remove ${c.aName} to ${c.bName}`} variant='ghost' onClick={() => removeConnection(c.id)}>×</Button>
          </div>
          {c.events.map((e) => (
            <EventEditor key={e.id} owner={{ kind: 'connection', id: c.id }} event={e}>
              <select aria-label={`${e.name} way`} className={selectClass} value={e.way} onChange={(ev) => setWay(c.id, e.id, ev.target.value as Way)}>
                {WAYS.map((way) => (
                  <option key={way} value={way}>{way === 'both' ? 'both ways' : way === 'there' ? `${c.aName} → ${c.bName}` : `${c.bName} → ${c.aName}`}</option>
                ))}
              </select>
            </EventEditor>
          ))}
        </div>
      ))}
    </div>
  )
}

// survival.tex "Events": an event, its DL to be found, what it needs known,
// and what it comes to at each degree.
function EventEditor({ owner, event, children }: { owner: EventOwner, event: EventView, children?: ReactNode }) {
  const { setEvent, toggleType, setEnabler, removeEvent } = useMapEditor()
  return (
    <div className='flex flex-col gap-1 ml-4 pl-2 border-l border-line'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='event name' value={event.name} onChange={(e) => setEvent(owner, event.id, { name: e.target.value })} />
        {children}
        <span className='text-xs text-muted'>DL</span>
        <NumberInput className='w-10' aria-label={`${event.name} DL`} value={event.DL} onChange={(e) => setEvent(owner, event.id, { DL: parseInt(e.target.value) || 0 })} />
        {EVENT_TYPES.map((type) => (
          <Button key={type} size='xs' variant='ghost' selected={event.types.includes(type)} onClick={() => toggleType(owner, event.id, type)}>{type}</Button>
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
