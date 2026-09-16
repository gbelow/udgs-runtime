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

// A bulk is stored as the index into the size list and picked by name.
function bulkSelect(names: readonly string[]): Widget {
  return function BulkSelect({ value, onChange }) {
    return (
      <select className={input} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))}>
        {names.map((name, bulk) => <option key={name} value={bulk}>{name}</option>)}
      </select>
    )
  }
}

const itemBulk = bulkSelect(BULK_NAMES)
// gear.tex "Slot size and stacking": slots come in the first three sizes only
const slotBulk = bulkSelect(BULK_NAMES.slice(0, 3))

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
    bulk: itemBulk,
    // a catalog item is a template; the id is minted when a copy lands on a character
    id: hidden,
  },
  containers: {
    'slots.quick.slotBulk': slotBulk,
    'slots.quick.items': hidden,
    'slots.medium.items': hidden,
    'slots.large.items': hidden,
  },
}
