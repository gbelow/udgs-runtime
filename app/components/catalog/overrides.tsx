'use client'
import { Overrides } from './SchemaForm'
import { CatalogName } from '../../forms/catalogs'
import { ABILITY_KEYS } from '../../domain/abilities'
import { SPELL_KEYS } from '../../domain/spells'
import { knowledges_list } from '../../domain/lists'
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
    // a catalog item is a template; the id is minted when a copy lands on a character
    id: () => null,
  },
  containers: {},
}
