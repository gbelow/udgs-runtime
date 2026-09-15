'use client'
import { useMemo, useState } from 'react'
import { SchemaForm, Overrides } from './SchemaForm'
import { describeSchema } from '../../forms/schemaFields'
import { AbilityFamilyInput, AbilityFamilySchema } from '../../domain/types'
import { useAbilityCatalog } from '../../hooks/useAbilityCatalog'
import { ABILITY_KEYS } from '../../domain/abilities'
import { SPELL_KEYS } from '../../domain/spells'

const TYPE = describeSchema(AbilityFamilySchema)
const input = 'bg-transparent border border-gray-600 rounded px-1 text-sm w-full'

// A requirement's name is a key into whichever catalog its kind points at;
// the list offers those keys and still takes a free word for gear, a
// trainable or a condition.
function RequirementName({ value, onChange, parent }: { value: unknown; onChange: (v: unknown) => void; parent: Record<string, unknown> }) {
  const kind = String(parent.kind ?? '')
  const options = kind === 'ability' ? ABILITY_KEYS : kind === 'spell' ? SPELL_KEYS : []
  const listId = `requirement-${kind}`
  return (
    <>
      <input className={input} type='text' list={listId} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{options.map((k) => <option key={k} value={k} />)}</datalist>
    </>
  )
}

const OVERRIDES: Overrides = {
  'stages.requirements.name': RequirementName,
  'stages.description': ({ value, onChange }) => (
    <textarea className={`${input} min-h-16`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
  ),
}

export function AbilityEditor() {
  const { families, draft, open, create, edit, save, remove } = useAbilityCatalog()
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState(false)

  const needle = filter.trim().toLowerCase()
  const sections = useMemo(() => {
    const visible = needle ? families.filter((f) => f.family.toLowerCase().includes(needle)) : families
    return visible.reduce<Record<string, typeof families>>((acc, f) => { (acc[f.section] ??= []).push(f); return acc }, {})
  }, [families, needle])

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-gray-700 pr-2 max-h-[85vh] overflow-y-auto'>
        <div className='flex flex-row gap-1'>
          <input className={input} type='text' placeholder='filter' aria-label='ability catalog filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
          <input type='button' className='border border-green-400 text-green-300 rounded px-1 text-xs' value='+ new' onClick={create} />
        </div>
        {Object.entries(sections).map(([section, rows]) => (
          <div key={section} className='flex flex-col'>
            <span className='text-xs uppercase text-gray-400 pt-1'>{section}</span>
            {rows.map((row) => (
              <button key={row.key} type='button'
                className={`text-left px-1 text-sm hover:bg-gray-500 ${draft?.key === row.key ? 'bg-gray-700' : ''}`}
                onClick={() => open(row.key)}>
                {row.family}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        {draft ? (
          <>
            <div className='flex flex-row items-center gap-2'>
              <span className='text-xs text-gray-400'>key</span>
              <span className='text-sm font-mono'>{draft.key || '—'}</span>
              <span className='grow' />
              <input type='button' className='border border-green-400 text-green-300 rounded px-2 text-xs' value='save' onClick={save} />
              {!draft.fresh && (confirm
                ? <>
                    <input type='button' className='border rounded bg-red-700 px-2 text-xs' value='confirm delete' onClick={async () => { await remove(); setConfirm(false) }} />
                    <input type='button' className='border rounded px-2 text-xs' value='cancel' onClick={() => setConfirm(false)} />
                  </>
                : <input type='button' className='border border-red-400 text-red-300 rounded px-2 text-xs' value='delete' onClick={() => setConfirm(true)} />)}
            </div>
            <SchemaForm type={TYPE} value={draft.value} onChange={(v) => edit(v as AbilityFamilyInput)} overrides={OVERRIDES} />
          </>
        ) : (
          <span className='text-sm text-gray-400'>Pick an ability to edit, or create a new one.</span>
        )}
      </div>
    </div>
  )
}
