'use client'
import { useMemo } from 'react'
import { Save } from 'lucide-react'
import { SchemaForm } from './SchemaForm'
import { OVERRIDES } from './overrides'
import { describeSchema } from '../../forms/schemaFields'
import { CATALOGS, CatalogName } from '../../forms/catalogs'
import { useCatalogEditor } from '../../hooks/useCatalogEditor'
import { Button, CatalogList, ConfirmDelete, ListButton } from '../ui'
import { EventEditor, ItemKeyList } from '../EventEditor'
import { useEventTemplateDraft } from '../../hooks/useEventTemplate'
import { useCatalogComparison } from '../../hooks/useCatalogComparison'
import { ComparisonTable } from './Compare'

type Editor = ReturnType<typeof useCatalogEditor>

// One catalog: its entries listed by group on the left, the schema-driven
// form for the picked or new entry on the right. Every catalog is this same
// panel; what differs is in forms/catalogs.ts and the overrides, but for the
// events, edited as the map edits an event. A comparable catalog lists its
// entries as the comparison table instead.
export function CatalogPanel({ catalog }: { catalog: CatalogName }) {
  const editor = useCatalogEditor(catalog)
  if ('comparable' in CATALOGS[catalog]) return <ComparedPanel catalog={catalog} editor={editor} />
  const { label, groups, draft, open, create } = editor
  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label={label} groups={groups} nameOf={(row) => row.name} beside={<Button size='xs' weight='subtle' tone='good' onClick={create}>+ new</Button>} render={(row) => (
          <ListButton key={row.key} selected={draft?.key === row.key} onClick={() => open(row.key)}>{row.name}</ListButton>
        )} />
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        <DraftForm catalog={catalog} editor={editor} />
      </div>
    </div>
  )
}

// The comparison table on the left, its row open marked, and the form on the right.
function ComparedPanel({ catalog, editor }: { catalog: CatalogName, editor: Editor }) {
  const comparison = useCatalogComparison(catalog)
  return (
    <div className='grid grid-cols-2 gap-2 text-left'>
      <div className='flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh]'>
        <ComparisonTable comparison={comparison} selected={editor.draft?.key ?? null} open={editor.open}
          beside={<Button size='xs' weight='subtle' tone='good' onClick={editor.create}>+ new</Button>} />
      </div>
      <div className='flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        <DraftForm catalog={catalog} editor={editor} />
      </div>
    </div>
  )
}

function DraftForm({ catalog, editor }: { catalog: CatalogName, editor: Editor }) {
  const { draft, edit, save, remove } = editor
  const type = useMemo(() => describeSchema(CATALOGS[catalog].schema), [catalog])
  if (!draft) return <span className='text-sm text-muted'>Pick an entry to edit, or create a new one.</span>
  return (
    <>
      <div className='flex flex-row items-center gap-2'>
        <span className='text-xs text-muted'>key</span>
        <span className='text-sm font-mono'>{draft.key || '—'}</span>
        <span className='grow' />
        <Button weight='solid' tone='accent' icon={Save} onClick={save}>save</Button>
        {!draft.fresh && <ConfirmDelete remove={remove} />}
      </div>
      {catalog === 'events'
        ? <EventTemplateForm value={draft.value} onChange={edit} />
        : <SchemaForm type={type} value={draft.value} onChange={(v) => edit(v as Record<string, unknown>)} overrides={OVERRIDES[catalog]} />}
    </>
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
