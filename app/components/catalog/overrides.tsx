'use client'
import { Overrides } from './SchemaForm'
import { CatalogName } from '../../forms/catalogs'
import { ABILITY_KEYS } from '../../domain/abilities'
import { SPELL_KEYS } from '../../domain/spells'
import { BULK_NAMES, knowledges_list } from '../../domain/lists'
import weapons from '../../assets/weapons.json'
import armors from '../../assets/armors.json'

const input = 'bg-transparent border border-gray-600 rounded px-1 text-sm w-full'

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

// A requirement's name is a key into whichever catalog its kind points at;
// gear, trainables and conditions stay free words.
const requirementName = suggesting((parent) => {
  const kind = String(parent.kind ?? '')
  return kind === 'ability' ? ABILITY_KEYS : kind === 'spell' ? SPELL_KEYS : []
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

export const OVERRIDES: Record<CatalogName, Overrides> = {
  abilities: {
    'stages.requirements.name': requirementName,
    'stages.description': textarea,
  },
  spells: {
    'knowledge.name': suggesting(() => knowledges_list),
    description: textarea,
    enhance: textarea,
    'outcomes.miss': textarea,
    'outcomes.graze': textarea,
    'outcomes.hit': textarea,
    'outcomes.crit': textarea,
  },
  weapons: {},
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
