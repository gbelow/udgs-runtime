'use client'
import { useMemo, useState } from 'react'
import { SchemaForm } from './SchemaForm'
import { OVERRIDES } from './overrides'
import { describeSchema } from '../../forms/schemaFields'
import { CATALOGS, CatalogName } from '../../forms/catalogs'
import { CatalogRow, useCatalogEditor } from '../../hooks/useCatalogEditor'
import { Button, ListButton, SectionLabel, TextInput } from '../ui'

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
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <div className='flex flex-row gap-1'>
          <TextInput className='w-full' placeholder='filter' aria-label={`${label} filter`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button size='xs' variant='good' onClick={create}>+ new</Button>
        </div>
        {Object.entries(groups).map(([group, entries]) => (
          <div key={group} className='flex flex-col'>
            {group ? <SectionLabel className='pt-2'>{group}</SectionLabel> : null}
            {entries.map((row) => (
              <ListButton key={row.key} selected={draft?.key === row.key} onClick={() => open(row.key)}>{row.name}</ListButton>
            ))}
          </div>
        ))}
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        {draft ? (
          <>
            <div className='flex flex-row items-center gap-2'>
              <span className='text-xs text-muted'>key</span>
              <span className='text-sm font-mono'>{draft.key || '—'}</span>
              <span className='grow' />
              <Button variant='primary' onClick={save}>save</Button>
              {!draft.fresh && (confirm
                ? <>
                    <Button variant='bad' className='bg-bad/15' onClick={async () => { await remove(); setConfirm(false) }}>confirm delete</Button>
                    <Button onClick={() => setConfirm(false)}>cancel</Button>
                  </>
                : <Button variant='bad' onClick={() => setConfirm(true)}>delete</Button>)}
            </div>
            <SchemaForm type={type} value={draft.value} onChange={(v) => edit(v as Record<string, unknown>)} overrides={OVERRIDES[catalog]} />
          </>
        ) : (
          <span className='text-sm text-muted'>Pick an entry to edit, or create a new one.</span>
        )}
      </div>
    </div>
  )
}
