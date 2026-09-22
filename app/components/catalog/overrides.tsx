'use client'
import { Overrides } from './SchemaForm'
import { inputClass } from '../ui'
import { CatalogName } from '../../forms/catalogs'
import { ABILITY_KEYS } from '../../domain/abilities'
import { SPELL_KEYS } from '../../domain/spells'
import { BULK_NAMES, HEAVY_MAX_DEGREE, knowledges_list } from '../../domain/lists'
import weapons from '../../assets/weapons.json'
import armors from '../../assets/armors.json'
import items from '../../assets/items.json'

const input = `${inputClass} text-sm w-full`

// The few fields whose widget the schema alone cannot pick: long text, and
// names that point into another catalog and want its keys offered.
type Widget = (props: { value: unknown; onChange: (v: unknown) => void; parent: Record<string, unknown> }) => React.ReactNode

const textarea: Widget = ({ value, onChange }) => (
  <textarea className={`${input} min-h-16`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
)

function suggesting(options: (parent: Record<string, unknown>) => readonly string[]): Widget {
  return function Suggesting({ value, onChange, parent }) {
    const list = options(parent)
    const listId = `suggest-${list.length}-${list[0] ?? ''}`
    return (
      <>
        <input className={input} type='text' list={listId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        <datalist id={listId}>{list.map((k) => <option key={k} value={k} />)}</datalist>
      </>
    )
  }
}

// A requirement's name is a key into whichever catalog its kind points at —
// spells.tex "Requirements": a gear item is the one the character has to
// have on them, so the item list is offered; trainables and conditions stay
// free words.
const requirementName = suggesting((parent) => {
  const kind = String(parent.kind ?? '')
  return kind === 'ability' ? ABILITY_KEYS : kind === 'spell' ? SPELL_KEYS : kind === 'gear' ? Object.keys(items) : []
})

// An item's refId resolves in the catalog its type names.
const itemRef = suggesting((parent) => {
  const type = String(parent.type ?? '')
  return type === 'weapon' ? Object.keys(weapons) : type === 'armor' ? Object.keys(armors) : []
})

// A bulk is stored as a number and picked by name while it has one; past the
// named steps the list goes on numerically, as far as the book's biggest item.
const BULK_OPTIONS: readonly string[] = [...BULK_NAMES, ...Array.from({ length: 5 }, (_, i) => String(BULK_NAMES.length + i))]

const bulkSelect: Widget = ({ value, onChange }) => (
  <select className={input} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))}>
    {BULK_OPTIONS.map((name, bulk) => <option key={name} value={bulk}>{name}</option>)}
  </select>
)

// a catalog container is a template; its slots are filled on a character
const hidden: Widget = () => null

// gear.tex "Reload": the second term of the AP column exists only on a row
// with the reload property, so the field appears with it. A bare number,
// not the optional's own set/unset toggle: ticking the property is the toggle.
const reloadCost: Widget = ({ value, onChange, parent }) => {
  const properties = Array.isArray(parent.properties) ? parent.properties : []
  if (!properties.includes('reload')) return null
  return <input className={input} type='number' step='any' value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
}

// gear.tex "Heavy I/II/III": a heavy property is a range of degrees, picked
// as its two ends. "normal" at the low end keeps the normal attack ("heavy
// II"); a degree there forbids it ("heavy I-II"). "normal" at the high end is
// no heavy at all, and the field is left absent like an unset reload.
const HEAVY_DEGREES = ['normal', ...Array.from({ length: HEAVY_MAX_DEGREE }, (_, i) => 'I'.repeat(i + 1))]

const heavyRange: Widget = ({ value, onChange }) => {
  const range = (value ?? null) as { min: number; max: number } | null
  const min = range?.min ?? 0
  const max = range?.max ?? 0
  const set = (nextMin: number, nextMax: number) => onChange(nextMax === 0 ? undefined : { min: Math.min(nextMin, nextMax), max: nextMax })
  const select = (label: string, degree: number, pick: (d: number) => void) => (
    <select className={input} aria-label={`heavy ${label}`} value={degree} onChange={(e) => pick(Number(e.target.value))}>
      {HEAVY_DEGREES.map((name, d) => <option key={name} value={d}>{name}</option>)}
    </select>
  )
  return (
    <div className='flex flex-row gap-1 items-center'>
      {select('from', min, (d) => set(d, Math.max(d, max)))}
      <span>to</span>
      {select('to', max, (d) => set(min, d))}
    </div>
  )
}

export const OVERRIDES: Record<CatalogName, Overrides> = {
  abilities: {
    'stages.requirements.name': requirementName,
    'stages.description': textarea,
  },
  spells: {
    'knowledge.name': suggesting(() => knowledges_list),
    'requirements.name': requirementName,
    description: textarea,
    enhance: textarea,
    'outcomes.miss': textarea,
    'outcomes.graze': textarea,
    'outcomes.hit': textarea,
    'outcomes.crit': textarea,
  },
  weapons: { 'attacks.reload': reloadCost, 'attacks.heavy': heavyRange },
  armors: { notes: textarea },
  items: {
    refId: itemRef,
    description: textarea,
    bulk: bulkSelect,
    // a catalog item is a template; the id is minted when a copy lands on a character
    id: hidden,
  },
  containers: {
    'slots.quick.slotBulk': bulkSelect,
    'slots.medium.slotBulk': bulkSelect,
    'slots.large.slotBulk': bulkSelect,
    'slots.quick.items': hidden,
    'slots.medium.items': hidden,
    'slots.large.items': hidden,
  },
}
