'use client'

import { useState, type ReactNode } from 'react'
import { Button, CollectionSelect, NumberInput, TextInput, selectClass } from './ui'
import { EVENT_TYPES, EventTestSchema, type EventOutcome, type EventResult, type EventTest, type Wear } from '../domain/campaign/types'
import { SkillKeySchema, type Degree } from '../domain/types'
import type { EventView } from '../domain/campaign/projections/map'
import type { EventCommand } from '../domain/campaign/commands/eventRegistry'
import { useItemCatalogRows } from '../hooks/useItemLens'
import { useCollectionFilter } from '../hooks/useCollections'

const DEGREES_SHOWN = ['critical', 'hit', 'graze', 'miss'] as const
const WEAR_KEYS = ['IL', 'exhaustion', 'hunger', 'thirst'] as const

type Edit = (command: EventCommand) => void

// survival.tex "Events": an event, and each of its stages' DL to be found,
// its types and what it comes to at each degree, one stage open at a time.
// On a map (`placed`) it is also the stage it is in, which the GM moves it
// between, the template it is made of, and what it changed of it.
export function EventEditor({ event, edit, placed, path, remove, children }: {
  event: EventView
  edit: Edit
  placed: boolean
  path?: boolean
  remove?: () => void
  children?: ReactNode
}) {
  const [open, setOpen] = useState(event.stage)
  const index = event.stages[open] ? open : 0
  const stage = event.stages[index]
  const label = (s: EventView['stages'][number], i: number) => s.name || `stage ${i + 1}`
  const changed = (key: 'name' | 'stages', text: string) => (event.custom.includes(key) ?
    <button type='button' className='text-xs text-accent' title={`changed here; click to take the ${key} from ${event.template} again`} onClick={() => edit({ kind: 'resetEventValue', args: [key] })}>{text} ↺</button>
    : null)
  return (
    <div className='flex flex-col gap-1 ml-4 pl-2 border-l border-line'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='event name' value={event.name} onChange={(e) => edit({ kind: 'setEventName', args: [e.target.value] })} />
        {changed('name', 'name')}
        {event.template ? <span className='text-xs text-muted'>from {event.template}{event.missing ? ' (not in the catalog)' : ''}</span> : null}
        {children}
        {placed ?
          <>
            <span className='text-xs text-muted'>is</span>
            <select aria-label={`${event.name} stage`} className={selectClass} value={event.stage} onChange={(e) => edit({ kind: 'setEventStage', args: [parseInt(e.target.value)] })}>
              {event.stages.map((s, i) => <option key={i} value={i}>{label(s, i)}</option>)}
            </select>
          </>
          : null}
        {remove ? <Button aria-label={`remove ${event.name}`} variant='ghost' onClick={remove}>×</Button> : null}
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {event.stages.map((s, i) => (
          <Button key={i} size='xs' variant='ghost' selected={i === index} onClick={() => setOpen(i)}>{label(s, i)}{placed && i === event.stage ? ' •' : ''}</Button>
        ))}
        <Button size='xs' variant='ghost' aria-label={`${event.name} add stage`} onClick={() => { edit({ kind: 'addStage', args: [] }); setOpen(event.stages.length) }}>+ stage</Button>
        {changed('stages', 'stages changed')}
      </div>
      {stage ?
        <>
          <div className='flex flex-row flex-wrap gap-1.5 items-center'>
            <TextInput className='w-28' aria-label={`${event.name} stage name`} placeholder={label(stage, index)} value={stage.name} onChange={(e) => edit({ kind: 'setStage', args: [index, { name: e.target.value }] })} />
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${event.name} DL`} value={stage.DL} onChange={(e) => edit({ kind: 'setStage', args: [index, { DL: parseInt(e.target.value) || 0 }] })} />
            {EVENT_TYPES.map((type) => (
              <Button key={type} size='xs' variant='ghost' selected={stage.types.includes(type)} onClick={() => edit({ kind: 'toggleStageType', args: [index, type] })}>{type}</Button>
            ))}
            {event.stages.length > 1 ?
              <Button size='xs' variant='ghost' aria-label={`${event.name} remove stage`} onClick={() => { edit({ kind: 'removeStage', args: [index] }); setOpen(0) }}>remove stage</Button>
              : null}
          </div>
          {DEGREES_SHOWN.map((degree) => (
            <OutcomeEditor key={degree} event={event} index={index} degree={degree} path={path ?? false} edit={edit} />
          ))}
        </>
        : null}
    </div>
  )
}

// What the stage comes to at one degree: the text the table reads, whether
// it takes the whole ET, whether it stops a group on the path, the wear it
// costs everyone present, what is found, and the test it asks of each.
function OutcomeEditor({ event, index, degree, path, edit }: { event: EventView, index: number, degree: Degree, path: boolean, edit: Edit }) {
  const outcome = event.stages[index].outcomes[degree]
  const set = (patch: Partial<EventOutcome>) => edit({ kind: 'setOutcome', args: [index, degree, patch] })
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
        {path ?
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

export function WearInputs({ label, wear, set }: { label: string, wear: Wear, set: (wear: Wear) => void }) {
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

// The catalog's items, offered by key to what an event finds; once per
// screen that edits events.
export function ItemKeyList() {
  const items = useItemCatalogRows()
  return (
    <datalist id='catalog-items'>
      {items.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}
    </datalist>
  )
}

// A new event for a node or a path: made of a template from the events
// catalog, picked among those the chosen collection offers, or of nothing.
export function AddEvent({ templates, add }: { templates: { key: string; name: string }[], add: (template: string | null) => void }) {
  const filter = useCollectionFilter('events')
  const kept = filter.keep(templates.map((t) => t.key))
  return (
    <>
      <Button size='xs' variant='ghost' onClick={() => add(null)}>+ event</Button>
      {templates.length > 0 ?
        <>
          <select aria-label='add event from template' className={selectClass} value='' onChange={(e) => e.target.value && add(e.target.value)}>
            <option value=''>+ from template…</option>
            {templates.filter((t) => kept.includes(t.key)).map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
          <CollectionSelect label='event collection' filter={filter} />
        </>
        : null}
    </>
  )
}
