'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, CollectionSelect, IconButton, NumberInput, ResetLink, TextInput, selectClass } from './ui'
import { AmbientSchema, EVENT_TYPES, EventTestSchema, PlaceChangeSchema, TERRAIN_TAGS, type EventOutcome, type EventResult, type EventTest, type Ambient, type PlaceChange, type TerrainTag, type Wear } from '../domain/campaign/types'
import { SkillKeySchema, type Degree } from '../domain/types'
import type { EventView } from '../domain/campaign/projections/map'
import type { EventCommand } from '../domain/campaign/commands/eventRegistry'
import { useItemCatalogRows } from '../hooks/useItemLens'
import { useCollectionFilter } from '../hooks/useCollections'
import { useScenePresets } from '../hooks/useScenePresets'
import { LearningInputs, LearningToggle } from './LearningInputs'

const DEGREES_SHOWN = ['critical', 'hit', 'graze', 'miss'] as const
const WEAR_KEYS = ['IL', 'exhaustion', 'hunger', 'thirst'] as const

type Edit = (command: EventCommand) => void

// survival.tex "Events": an event — its name and what the table reads of it,
// the DL it is found against, its types, and what it comes to at each degree
// — on a node, on a path, or (`on: 'any'`) a template either may be made of:
// a path's event may turn a group back, a node's may be ambient or a shelter.
// Each value changed from the template it is made of can be taken from it
// again.
export function EventEditor({ event, edit, on, remove, children }: {
  event: EventView
  edit: Edit
  on: 'node' | 'path' | 'any'
  remove?: () => void
  children?: ReactNode
}) {
  const reset = (key: EventView['custom'][number]) => (event.custom.includes(key) ?
    <ResetLink aria-label={`reset ${key}`} title={`changed here; click to take it from ${event.template} again`} onClick={() => edit({ kind: 'resetEventValue', args: [key] })} />
    : null)
  return (
    <div className='flex flex-col gap-1 ml-4 pl-2 border-l border-line'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <TextInput className='w-40' aria-label='event name' value={event.name} onChange={(e) => edit({ kind: 'setEvent', args: [{ name: e.target.value }] })} />
        {reset('name')}
        {event.template ? <span className='text-xs text-muted'>from {event.template}{event.missing ? ' (not in the catalog)' : ''}</span> : null}
        {children}
        {remove ? <IconButton icon={X} tone='bad' aria-label={`remove ${event.name}`} onClick={remove} /> : null}
      </div>
      <div className='flex flex-row gap-1.5 items-center'>
        <TextInput className='grow' aria-label={`${event.name} description`} placeholder='what it is: a grove to make camp, a group of bandits' value={event.text} onChange={(e) => edit({ kind: 'setEvent', args: [{ text: e.target.value }] })} />
        {reset('text')}
      </div>
      {on === 'path' ? null :
        <div className='flex flex-row flex-wrap gap-1.5 items-center'>
          <label className='text-xs text-muted flex items-center gap-1'>
            <input type='checkbox' aria-label={`${event.name} ambient`} checked={event.ambient !== null}
              onChange={(e) => edit({ kind: 'setEvent', args: [{ ambient: e.target.checked ? AmbientSchema.parse({}) : null }] })} />ambient: happens by itself, met by no exploration test
          </label>
          {reset('ambient')}
        </div>}
      {event.ambient ? <AmbientInputs label={event.name} ambient={event.ambient} set={(ambient) => edit({ kind: 'setEvent', args: [{ ambient }] })} /> : <>
        <div className='flex flex-row flex-wrap gap-1.5 items-center'>
          <span className='text-xs text-muted'>found at DL</span>
          <NumberInput className='w-10' aria-label={`${event.name} DL`} value={event.DL} onChange={(e) => edit({ kind: 'setEvent', args: [{ DL: parseInt(e.target.value) || 0 }] })} />
          {reset('DL')}
          {EVENT_TYPES.map((type) => (
            <Button key={type} size='xs' selected={event.types.includes(type)} onClick={() => edit({ kind: 'toggleEventType', args: [type] })}>{type}</Button>
          ))}
          {reset('types')}
        </div>
        <div className='flex flex-row flex-wrap gap-1.5 items-center'>
          {on === 'path' ? null : <>
            <label className='text-xs text-muted flex items-center gap-1'>
              <input type='checkbox' aria-label={`${event.name} shelter`} checked={event.shelter !== null}
                onChange={(e) => edit({ kind: 'setEvent', args: [{ shelter: e.target.checked ? PlaceChangeSchema.parse({}) : null }] })} />a shelter to camp in
            </label>
            {event.shelter ? <PlaceChangeInputs label={`${event.name} shelter`} change={event.shelter} set={(shelter) => edit({ kind: 'setEvent', args: [{ shelter }] })} /> : null}
            {reset('shelter')}
          </>}
          <label className='text-xs text-muted flex items-center gap-1' title='what is found stays on it to be found again: a spring, a tree that fruits again'>
            <input type='checkbox' aria-label={`${event.name} renews`} checked={event.renews} onChange={(e) => edit({ kind: 'setEvent', args: [{ renews: e.target.checked }] })} />renews what it gives
          </label>
          {reset('renews')}
        </div>
        <div className='flex flex-row items-center gap-1'>
          <span className='text-xs text-muted'>what it comes to</span>
          {reset('outcomes')}
        </div>
        {DEGREES_SHOWN.map((degree) => (
          <OutcomeEditor key={degree} event={event} degree={degree} on={on} edit={edit} />
        ))}
      </>}
    </div>
  )
}

// What the event comes to at one degree: the text the table reads, whether
// it takes the whole ET, whether it turns a group on the path back, the wear
// it costs everyone present, what is found, and the test it asks of each.
function OutcomeEditor({ event, degree, on, edit }: { event: EventView, degree: Degree, on: 'node' | 'path' | 'any', edit: Edit }) {
  const outcome = event.outcomes[degree]
  const set = (patch: Partial<EventOutcome>) => edit({ kind: 'setOutcome', args: [degree, patch] })
  const name = `${event.name} ${degree}`
  const presets = useScenePresets()
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
        {on === 'node' ? null :
          <label className='text-xs text-muted flex items-center gap-1' title='on a path: the group does not arrive, and ends the ET where it set out from'>
            <input type='checkbox' aria-label={`${name} turns back`} checked={outcome.stop} onChange={(e) => set({ stop: e.target.checked })} />turns them back
          </label>}
        <WearInputs label={name} wear={outcome.wear} set={(wear) => set({ wear })} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${name} weather`} checked={outcome.weather !== null} onChange={(e) => set({ weather: e.target.checked ? PlaceChangeSchema.parse({}) : null })} />weather this ET
        </label>
        {outcome.weather ? <PlaceChangeInputs label={`${name} weather`} change={outcome.weather} set={(weather) => set({ weather })} /> : null}
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <span className='text-xs text-muted'>leads to the scene</span>
        <select aria-label={`${name} scene`} className={selectClass} value={outcome.scene?.preset ?? ''}
          onChange={(e) => set({ scene: e.target.value ? { preset: e.target.value, forced: outcome.scene?.forced ?? (degree === 'graze' || degree === 'miss') } : null })}>
          <option value=''>none</option>
          {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          {outcome.scene && !presets.some((p) => p.key === outcome.scene?.preset) ? <option value={outcome.scene.preset}>{outcome.scene.preset} (not in the catalog)</option> : null}
        </select>
        {outcome.scene ?
          <label className='text-xs text-muted flex items-center gap-1'>
            <input type='checkbox' aria-label={`${name} scene forced`} checked={outcome.scene.forced} onChange={(e) => outcome.scene && set({ scene: { ...outcome.scene, forced: e.target.checked } })} />forced, not offered
          </label>
          : null}
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <span className='text-xs text-muted'>finds</span>
        {outcome.items.map((item, i) => (
          <span key={i} className='flex flex-row gap-1 items-center'>
            <NumberInput className='w-12' aria-label={`${name} item ${i + 1} amount`} value={item.amount}
              onChange={(e) => set({ items: outcome.items.map((it, n) => (n === i ? { ...it, amount: Math.max(1, parseInt(e.target.value) || 1) } : it)) })} />
            <TextInput className='w-32' list='catalog-items' aria-label={`${name} item ${i + 1}`} value={item.key}
              onChange={(e) => set({ items: outcome.items.map((it, n) => (n === i ? { ...it, key: e.target.value } : it)) })} />
            <IconButton icon={X} tone='bad' aria-label={`${name} remove item ${i + 1}`} onClick={() => set({ items: outcome.items.filter((_, n) => n !== i) })} />
          </span>
        ))}
        <Button size='xs' weight='subtle' aria-label={`${name} add item`} onClick={() => set({ items: [...outcome.items, { key: '', amount: 1 }] })}>+ item</Button>
      </div>
      <TestInputs label={name} test={outcome.test} set={(test) => set({ test })} />
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <span className='text-xs text-muted'>everyone learns</span>
        {outcome.learning ? <LearningInputs label={name} learning={outcome.learning} set={(learning) => set({ learning })} /> : null}
        <LearningToggle label={name} learning={outcome.learning} set={(learning) => set({ learning })} />
      </div>
    </div>
  )
}

// The test an event asks of everyone it lands on, and what each degree of it
// says and costs.
function TestInputs({ label, test, set }: { label: string, test: EventTest | null, set: (test: EventTest | null) => void }) {
  return (
    <>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <label className='text-xs text-muted flex items-center gap-1'>
          <input type='checkbox' aria-label={`${label} test`} checked={test !== null} onChange={(e) => set(e.target.checked ? EventTestSchema.parse({}) : null)} />everyone tests
        </label>
        {test ?
          <>
            <select aria-label={`${label} test skill`} className={selectClass} value={test.skill} onChange={(e) => set({ ...test, skill: e.target.value as EventTest['skill'] })}>
              {SkillKeySchema.options.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <span className='text-xs text-muted'>DL</span>
            <NumberInput className='w-10' aria-label={`${label} test DL`} value={test.DL} onChange={(e) => set({ ...test, DL: parseInt(e.target.value) || 0 })} />
          </>
          : null}
      </div>
      {test ? DEGREES_SHOWN.map((d) => {
        const result = test.results[d]
        const setResult = (patch: Partial<EventResult>) => set({ ...test, results: { ...test.results, [d]: { ...result, ...patch } } })
        return (
          <div key={d} className='flex flex-row flex-wrap gap-1.5 items-center ml-20'>
            <span className='text-xs text-muted w-12'>{d}</span>
            <TextInput className='w-48' aria-label={`${label} test ${d}`} value={result.text} onChange={(e) => setResult({ text: e.target.value })} />
            <WearInputs label={`${label} test ${d}`} wear={result.wear} set={(wear) => setResult({ wear })} />
          </div>
        )
      }) : null}
    </>
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

// What a change does to a place: its exposure set to a value (left empty, it
// is raised by the other number instead), and each tag added, taken away, or
// left as it is.
function PlaceChangeInputs({ label, change, set }: { label: string, change: PlaceChange, set: (change: PlaceChange) => void }) {
  const cycle = (tag: TerrainTag): PlaceChange => (change.add.includes(tag)
    ? { ...change, add: change.add.filter((t) => t !== tag), remove: [...change.remove, tag] }
    : change.remove.includes(tag) ? { ...change, remove: change.remove.filter((t) => t !== tag) } : { ...change, add: [...change.add, tag] })
  return (
    <>
      <span className='text-xs text-muted'>exposure =</span>
      <NumberInput className='w-10' aria-label={`${label} exposure`} value={change.exposure ?? ''} onChange={(e) => set({ ...change, exposure: e.target.value === '' ? null : parseInt(e.target.value) || 0 })} />
      <span className='text-xs text-muted'>or +</span>
      <NumberInput className='w-10' aria-label={`${label} raise`} disabled={change.exposure !== null} value={change.raise} onChange={(e) => set({ ...change, raise: parseInt(e.target.value) || 0 })} />
      {TERRAIN_TAGS.map((tag) => (
        <Button key={tag} size='xs' selected={change.add.includes(tag) || change.remove.includes(tag)} aria-label={`${label} ${tag}`}
          title='click: add it, again: keep it out, again: leave it' onClick={() => set(cycle(tag))}>
          {change.add.includes(tag) ? `+${tag}` : change.remove.includes(tag) ? `−${tag}` : tag}
        </Button>
      ))}
    </>
  )
}

// An ambient stage: its chance in 100 to happen each ET, what the table
// reads when it does, the weather it brings on the node, the wear it costs
// everyone there, and the test it asks of each.
function AmbientInputs({ label, ambient, set }: { label: string, ambient: Ambient, set: (ambient: Ambient) => void }) {
  const name = `${label} ambient`
  return (
    <div className='flex flex-col gap-1 border-t border-line pt-1'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <NumberInput className='w-12' aria-label={`${label} chance`} value={ambient.chance} onChange={(e) => set({ ...ambient, chance: parseInt(e.target.value) || 0 })} />
        <span className='text-xs text-muted'>% of ETs</span>
        <TextInput className='grow' aria-label={`${name} text`} placeholder='what happens' value={ambient.text} onChange={(e) => set({ ...ambient, text: e.target.value })} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <PlaceChangeInputs label={name} change={ambient.weather} set={(weather) => set({ ...ambient, weather })} />
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center ml-14'>
        <WearInputs label={name} wear={ambient.wear} set={(wear) => set({ ...ambient, wear })} />
      </div>
      <TestInputs label={name} test={ambient.test} set={(test) => set({ ...ambient, test })} />
    </div>
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
      <Button size='xs' weight='subtle' onClick={() => add(null)}>+ event</Button>
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
