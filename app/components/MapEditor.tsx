'use client'

import { useState, type ReactNode } from 'react'
import { Button, CollectionSelect, ListButton, NumberInput, Panel, SectionLabel, TextInput, selectClass } from './ui'
import { MapCanvas, type MapSelection } from './MapCanvas'
import { useCollectionFilter } from '../hooks/useCollections'
import { MapEditingContext, useMapEditing, useMapEditor } from '../hooks/useMap'
import { EVENT_TYPES, EventTestSchema, TERRAIN_TAGS, WAYS, type EventOutcome, type EventOwner, type EventResult, type EventTest, type TerrainValues, type Wear, type Way } from '../domain/campaign/types'
import { SkillKeySchema, type Degree } from '../domain/types'
import { useItemCatalogRows } from '../hooks/useItemLens'
import { knowledges_list } from '../domain/lists'
import type { EventView, NodeEditorView } from '../domain/campaign/projections/map'

const DEGREES_SHOWN = ['critical', 'hit', 'graze', 'miss'] as const
const WEAR_KEYS = ['IL', 'exhaustion', 'hunger', 'thirst'] as const

// survival.tex "Creating the point crawl": the saved maps on the left, the
// map being made on the right — its nodes, each made of a terrain from the
// catalog, the paths between them, and the events on both.
export function MapEditor() {
  const editing = useMapEditor()
  return (
    <MapEditingContext.Provider value={editing}>
      <div className='grid grid-cols-12 gap-2 py-2 text-left text-sm'>
        <MapList />
        <div className='col-span-10 min-w-0 flex flex-col gap-4 max-h-[85vh] overflow-y-auto pr-2'>
          <MapHeader />
          <MapBody />
        </div>
      </div>
    </MapEditingContext.Provider>
  )
}

// The map drawn, and whatever is picked on it opened beside it: a node's
// terrain and events, a path's DLs and events. Edited wherever the map is
// kept: the catalog's, or one of the campaign's copies.
export function MapBody() {
  const { view } = useMapEditing()
  const items = useItemCatalogRows()
  const [picked, select] = useState<MapSelection>(null)
  const selected = picked && (picked.kind === 'node' ? view.nodes.some((n) => n.id === picked.id) : view.connections.some((c) => c.id === picked.id)) ? picked : null
  return (
    <div className='flex flex-col lg:flex-row gap-3 items-start'>
      <MapCanvas selected={selected} select={select} />
      <div className='flex flex-col gap-2 w-full lg:w-[28rem] shrink-0'>
        {selected?.kind === 'node' ? <NodeInspector id={selected.id} close={() => select(null)} /> : null}
        {selected?.kind === 'connection' ? <PathInspector id={selected.id} close={() => select(null)} /> : null}
        {selected ? null : <span className='text-xs text-muted'>Pick a node or a path to see what is in it.</span>}
      </div>
      <datalist id='knowledges'>
        {knowledges_list.map((k) => <option key={k} value={k} />)}
      </datalist>
      <datalist id='catalog-items'>
        {items.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}
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
      <Button variant='good' disabled={!view.name.trim()} title={view.name.trim() ? undefined : 'Maps need a name'} onClick={save}>save</Button>
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

function NodeInspector({ id, close }: { id: string, close: () => void }) {
  const { view, setNode, toggleSettlement, setSettlementLiving, removeNode, addEvent } = useMapEditing()
  const filter = useCollectionFilter('terrains')
  const n = view.nodes.find((n) => n.id === id)
  if (!n) return null
  return (
    <Panel title={n.name || 'node'} meta='node' actions={<Button size='xs' variant='ghost' aria-label='close' onClick={close}>×</Button>}>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='node name' value={n.name} onChange={(e) => setNode(n.id, { name: e.target.value })} />
        <select aria-label={`${n.name} terrain`} className={selectClass} value={n.terrain ?? ''} onChange={(e) => setNode(n.id, { terrain: e.target.value || null })}>
          <option value=''>no terrain</option>
          {n.terrain && !view.presets.includes(n.terrain) ? <option value={n.terrain}>{n.terrain} (not in the catalog)</option> : null}
          {filter.keep(view.presets, n.terrain).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <CollectionSelect label='terrain collection' filter={filter} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${n.name} settlement`} checked={n.settlement !== null} onChange={() => toggleSettlement(n.id)} />settlement
        </label>
        {n.settlement ?
          <>
            <span className='text-xs text-muted' title='story.tex "Cost of Living": the cost of living changes from town to town'>living cost ×</span>
            <NumberInput className='w-12' step={0.1} aria-label={`${n.name} living cost`} value={n.settlement.living} onChange={(e) => setSettlementLiving(n.id, parseFloat(e.target.value) || 0)} />
          </>
          : null}
      </div>
      <NodeTerrain node={n} />
      {n.events.map((e) => <EventEditor key={e.id} owner={{ kind: 'node', id: n.id }} event={e} />)}
      <div className='flex flex-row gap-1.5 items-center'>
        <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'node', id: n.id })}>+ event</Button>
        <span className='grow' />
        {n.removeBar ? <span className='text-xs text-muted'>{n.removeBar}</span> : null}
        <Button size='xs' variant='bad' disabled={n.removeBar !== null} title={n.removeBar ?? undefined} onClick={() => { close(); removeNode(n.id) }}>remove node</Button>
      </div>
    </Panel>
  )
}

// What the node is made of: its terrain's values, the ones the node changed
// marked, each to be taken from the terrain again.
function NodeTerrain({ node }: { node: NodeEditorView }) {
  const { customizeNode, customizeWear, toggleTag, resetValue } = useMapEditing()
  const values = node.values
  if (!values) return null
  const label = (key: keyof TerrainValues, text: string) => (
    node.custom.includes(key) ?
      <button type='button' className='text-xs text-accent' title='changed on this node; click to take it from the terrain' onClick={() => resetValue(node.id, key)}>{text} ↺</button>
      : <span className='text-xs text-muted'>{text}</span>
  )
  return (
    <div className='flex flex-row flex-wrap gap-1.5 items-center'>
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

function PathInspector({ id, close }: { id: string, close: () => void }) {
  const { view, setConnection, removeConnection, addEvent, setWay } = useMapEditing()
  const c = view.connections.find((c) => c.id === id)
  if (!c) return null
  return (
    <Panel title={`${c.aName} ↔ ${c.bName}`} meta='path' actions={<Button size='xs' variant='ghost' aria-label='close' onClick={close}>×</Button>}>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-sm'>{c.aName} → {c.bName}</span>
        <span className='text-xs text-muted'>DL</span>
        <NumberInput className='w-10' aria-label={`${c.aName} to ${c.bName} DL`} value={c.DL} onChange={(e) => setConnection(c.id, { DL: parseInt(e.target.value) || 0 })} />
        <span className='text-sm'>· {c.bName} → {c.aName}</span>
        <span className='text-xs text-muted'>DL</span>
        <NumberInput className='w-10' aria-label={`${c.bName} to ${c.aName} DL`} value={c.backDL} onChange={(e) => setConnection(c.id, { backDL: parseInt(e.target.value) || 0 })} />
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
      <div className='flex flex-row gap-1.5 items-center'>
        <Button size='xs' variant='ghost' onClick={() => addEvent({ kind: 'connection', id: c.id })}>+ event</Button>
        <span className='grow' />
        <Button size='xs' variant='bad' aria-label={`remove ${c.aName} to ${c.bName}`} onClick={() => { close(); removeConnection(c.id) }}>remove path</Button>
      </div>
    </Panel>
  )
}

// survival.tex "Events": an event, the stage it is in, which the GM moves it
// between, and each stage's DL to be found, its types and what it comes to
// at each degree. One stage is open at a time.
function EventEditor({ owner, event, children }: { owner: EventOwner, event: EventView, children?: ReactNode }) {
  const { setEvent, setEventStage, addStage, removeStage, setStage, toggleType, removeEvent } = useMapEditing()
  const [open, setOpen] = useState(event.stage)
  const index = event.stages[open] ? open : 0
  const stage = event.stages[index]
  const label = (s: EventView['stages'][number], i: number) => s.name || `stage ${i + 1}`
  return (
    <div className='flex flex-col gap-1 ml-4 pl-2 border-l border-line'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='event name' value={event.name} onChange={(e) => setEvent(owner, event.id, { name: e.target.value })} />
        {children}
        <span className='text-xs text-muted'>is</span>
        <select aria-label={`${event.name} stage`} className={selectClass} value={event.stage} onChange={(e) => setEventStage(owner, event.id, parseInt(e.target.value))}>
          {event.stages.map((s, i) => <option key={i} value={i}>{label(s, i)}</option>)}
        </select>
        <Button aria-label={`remove ${event.name}`} variant='ghost' onClick={() => removeEvent(owner, event.id)}>×</Button>
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {event.stages.map((s, i) => (
          <Button key={i} size='xs' variant='ghost' selected={i === index} onClick={() => setOpen(i)}>{label(s, i)}{i === event.stage ? ' •' : ''}</Button>
        ))}
        <Button size='xs' variant='ghost' aria-label={`${event.name} add stage`} onClick={() => { addStage(owner, event.id); setOpen(event.stages.length) }}>+ stage</Button>
      </div>
      {stage ?
        <>
          <div className='flex flex-row flex-wrap gap-1.5 items-center'>
            <TextInput className='w-28' aria-label={`${event.name} stage name`} placeholder={label(stage, index)} value={stage.name} onChange={(e) => setStage(owner, event.id, index, { name: e.target.value })} />
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${event.name} DL`} value={stage.DL} onChange={(e) => setStage(owner, event.id, index, { DL: parseInt(e.target.value) || 0 })} />
            {EVENT_TYPES.map((type) => (
              <Button key={type} size='xs' variant='ghost' selected={stage.types.includes(type)} onClick={() => toggleType(owner, event.id, index, type)}>{type}</Button>
            ))}
            {event.stages.length > 1 ?
              <Button size='xs' variant='ghost' aria-label={`${event.name} remove stage`} onClick={() => { removeStage(owner, event.id, index); setOpen(0) }}>remove stage</Button>
              : null}
          </div>
          {DEGREES_SHOWN.map((degree) => (
            <OutcomeEditor key={degree} owner={owner} event={event} index={index} degree={degree} />
          ))}
        </>
        : null}
    </div>
  )
}

// What the stage comes to at one degree: the text the table reads, whether
// it takes the whole ET, whether it stops a group on the path, the wear it
// costs everyone present, what is found, and the test it asks of each.
function OutcomeEditor({ owner, event, index, degree }: { owner: EventOwner, event: EventView, index: number, degree: Degree }) {
  const { setOutcome } = useMapEditing()
  const outcome = event.stages[index].outcomes[degree]
  const set = (patch: Partial<EventOutcome>) => setOutcome(owner, event.id, index, degree, patch)
  const test = outcome.test
  const name = `${event.name} ${degree}`
  return (
    <div className='flex flex-col gap-1 border-t border-line pt-1'>
      <div className='flex flex-row gap-1.5 items-center'>
        <span className='text-xs text-muted w-14'>{degree}</span>
        <TextInput className='grow' aria-label={name} value={outcome.text} onChange={(e) => set({ text: e.target.value })} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${name} takes the ET`} checked={outcome.takesET} onChange={(e) => set({ takesET: e.target.checked })} />takes the ET
        </label>
        {owner.kind === 'connection' ?
          <label className='text-xs text-muted flex items-center gap-1'>
            <input type='checkbox' aria-label={`${name} stops`} checked={outcome.stop} onChange={(e) => set({ stop: e.target.checked })} />stops the group
          </label>
          : null}
        <WearInputs label={name} wear={outcome.wear} set={(wear) => set({ wear })} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <span className='text-xs text-muted'>finds</span>
        {outcome.items.map((item, i) => (
          <span key={i} className='flex flex-row gap-1 items-center'>
            <NumberInput className='w-12' aria-label={`${name} item ${i + 1} amount`} value={item.amount}
              onChange={(e) => set({ items: outcome.items.map((it, n) => (n === i ? { ...it, amount: Math.max(1, parseInt(e.target.value) || 1) } : it)) })} />
            <TextInput className='w-32' list='catalog-items' aria-label={`${name} item ${i + 1}`} value={item.key}
              onChange={(e) => set({ items: outcome.items.map((it, n) => (n === i ? { ...it, key: e.target.value } : it)) })} />
            <Button size='xs' variant='ghost' aria-label={`${name} remove item ${i + 1}`} onClick={() => set({ items: outcome.items.filter((_, n) => n !== i) })}>×</Button>
          </span>
        ))}
        <Button size='xs' variant='ghost' aria-label={`${name} add item`} onClick={() => set({ items: [...outcome.items, { key: '', amount: 1 }] })}>+ item</Button>
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${name} test`} checked={test !== null} onChange={(e) => set({ test: e.target.checked ? EventTestSchema.parse({}) : null })} />everyone tests
        </label>
        {test ?
          <>
            <select aria-label={`${name} test skill`} className={selectClass} value={test.skill} onChange={(e) => set({ test: { ...test, skill: e.target.value as EventTest['skill'] } })}>
              {SkillKeySchema.options.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${name} test DL`} value={test.DL} onChange={(e) => set({ test: { ...test, DL: parseInt(e.target.value) || 0 } })} />
          </>
          : null}
      </div>
      {test ? DEGREES_SHOWN.map((d) => {
        const result = test.results[d]
        const setResult = (patch: Partial<EventResult>) => set({ test: { ...test, results: { ...test.results, [d]: { ...result, ...patch } } } })
        return (
          <div key={d} className='flex flex-row flex-wrap gap-1.5 items-center ml-20'>
            <span className='text-xs text-muted w-12'>{d}</span>
            <TextInput className='w-48' aria-label={`${name} test ${d}`} value={result.text} onChange={(e) => setResult({ text: e.target.value })} />
            <WearInputs label={`${name} test ${d}`} wear={result.wear} set={(wear) => setResult({ wear })} />
          </div>
        )
      }) : null}
    </div>
  )
}

function WearInputs({ label, wear, set }: { label: string, wear: Wear, set: (wear: Wear) => void }) {
  return (
    <>
      {WEAR_KEYS.map((key) => (
        <span key={key} className='flex flex-row gap-1 items-center'>
          <span className='text-xs text-muted'>{key}</span>
          <NumberInput className='w-10' aria-label={`${label} wear ${key}`} value={wear[key]} onChange={(e) => set({ ...wear, [key]: parseInt(e.target.value) || 0 })} />
        </span>
      ))}
    </>
  )
}
