'use client'
import { useMemo, useState } from 'react'
import { SchemaForm } from './SchemaForm'
import { OVERRIDES } from './overrides'
import { describeSchema } from '../../forms/schemaFields'
import { CATALOGS, CatalogName } from '../../forms/catalogs'
import { CatalogRow, useCatalogEditor } from '../../hooks/useCatalogEditor'

const input = 'bg-transparent border border-gray-600 rounded px-1 text-sm w-full'

// One catalog: its entries listed by group on the left, the schema-driven
// form for the picked or new entry on the right. Every catalog is this same
// panel; what differs is in forms/catalogs.ts and the overrides.
export function CatalogPanel({ catalog }: { catalog: CatalogName }) {
  const { label, rows, draft, open, create, edit, save, remove } = useCatalogEditor(catalog)
  const type = useMemo(() => describeSchema(CATALOGS[catalog].schema), [catalog])
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState(false)

  const needle = filter.trim().toLowerCase()
  const groups = useMemo(() => {
    const visible = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows
    return visible.reduce<Record<string, CatalogRow[]>>((acc, r) => { (acc[r.group] ??= []).push(r); return acc }, {})
  }, [rows, needle])

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-gray-700 pr-2 max-h-[85vh] overflow-y-auto'>
        <div className='flex flex-row gap-1'>
          <input className={input} type='text' placeholder='filter' aria-label={`${label} filter`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <input type='button' className='border border-green-400 text-green-300 rounded px-1 text-xs' value='+ new' onClick={create} />
        </div>
        {Object.entries(groups).map(([group, entries]) => (
          <div key={group} className='flex flex-col'>
            {group ? <span className='text-xs uppercase text-gray-400 pt-1'>{group}</span> : null}
            {entries.map((row) => (
              <button key={row.key} type='button'
                className={`text-left px-1 text-sm hover:bg-gray-500 ${draft?.key === row.key ? 'bg-gray-700' : ''}`}
                onClick={() => open(row.key)}>
                {row.name}
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
            <SchemaForm type={type} value={draft.value} onChange={(v) => edit(v as Record<string, unknown>)} overrides={OVERRIDES[catalog]} />
          </>
        ) : (
          <span className='text-sm text-gray-400'>Pick an entry to edit, or create a new one.</span>
        )}
      </div>
    </div>
  )
}
