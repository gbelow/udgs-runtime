'use client'
import { useMemo } from 'react'
import { SchemaForm } from './SchemaForm'
import { OVERRIDES } from './overrides'
import { describeSchema } from '../../forms/schemaFields'
import { CATALOGS, CatalogName } from '../../forms/catalogs'
import { useCatalogEditor } from '../../hooks/useCatalogEditor'
import { Button, CatalogList, ConfirmDelete, ListButton } from '../ui'
import { EventEditor, ItemKeyList } from '../EventEditor'
import { useEventTemplateDraft } from '../../hooks/useEventTemplate'

// One catalog: its entries listed by group on the left, the schema-driven
// form for the picked or new entry on the right. Every catalog is this same
// panel; what differs is in forms/catalogs.ts and the overrides, but for the
// events, edited as the map edits an event.
export function CatalogPanel({ catalog }: { catalog: CatalogName }) {
  const { label, groups, draft, open, create, edit, save, remove } = useCatalogEditor(catalog)
  const type = useMemo(() => describeSchema(CATALOGS[catalog].schema), [catalog])

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label={label} groups={groups} nameOf={(row) => row.name} beside={<Button size='xs' variant='good' onClick={create}>+ new</Button>} render={(row) => (
          <ListButton key={row.key} selected={draft?.key === row.key} onClick={() => open(row.key)}>{row.name}</ListButton>
        )} />
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        {draft ? (
          <>
            <div className='flex flex-row items-center gap-2'>
              <span className='text-xs text-muted'>key</span>
              <span className='text-sm font-mono'>{draft.key || '—'}</span>
              <span className='grow' />
              <Button variant='primary' onClick={save}>save</Button>
              {!draft.fresh && <ConfirmDelete remove={remove} />}
            </div>
            {catalog === 'events'
              ? <EventTemplateForm value={draft.value} onChange={edit} />
              : <SchemaForm type={type} value={draft.value} onChange={(v) => edit(v as Record<string, unknown>)} overrides={OVERRIDES[catalog]} />}
          </>
        ) : (
          <span className='text-sm text-muted'>Pick an entry to edit, or create a new one.</span>
        )}
      </div>
    </div>
  )
}

// survival.tex "Events": an event template, edited with the map's event
// editor, offering what an event on a node or on a path may be.
function EventTemplateForm({ value, onChange }: { value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void }) {
  const { view, edit } = useEventTemplateDraft(value, onChange)
  return (
    <>
      <ItemKeyList />
      <EventEditor event={view} edit={edit} on='any' />
    </>
  )
}
