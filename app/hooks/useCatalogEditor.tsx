import { useState } from 'react'
import { toast } from 'sonner'
import { deleteCatalogEntry, saveCatalogEntry } from '../actions'
import { CATALOGS, CatalogName, CatalogSpec, getCatalogRows } from '../forms/catalogs'
import { emptyValue } from '../forms/schemaFields'
import { getCatalogGroups } from '../domain/campaign/projections/collections'

// `opened` is the entry as it stood on disk when the draft was taken from it.
export type CatalogDraft = { key: string; value: Record<string, unknown>; fresh: boolean; opened: Record<string, unknown> | null }

// A catalog as its editor sees it: the entries on disk, a draft being
// edited, and the two writes. The catalog itself is a module constant
// imported from app/assets, so a saved edit reaches the app when the dev
// server reloads that module; the draft is what the form holds meanwhile.
export function useCatalogEditor(catalog: CatalogName) {
  const spec: CatalogSpec = CATALOGS[catalog]
  const [draft, setDraft] = useState<CatalogDraft | null>(null)

  const groups = getCatalogGroups(getCatalogRows(spec))

  const open = (key: string) => {
    const entry = spec.data[key]
    if (entry) setDraft({ key, value: structuredClone(entry) as Record<string, unknown>, fresh: false, opened: entry as Record<string, unknown> })
  }

  const create = () => {
    setDraft({ key: '', value: emptyValue(spec.schema) as Record<string, unknown>, fresh: true, opened: null })
  }

  const edit = (value: Record<string, unknown>) => {
    if (!draft) return
    // a new entry is filed under its own name until it is saved
    setDraft({ ...draft, value, key: draft.fresh ? spec.keyOf(value) : draft.key })
  }

  const save = async () => {
    if (!draft) return
    const res = await saveCatalogEntry(catalog, draft.key, draft.value, draft.opened)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Saved ${spec.nameOf(draft.value)}.`)
    setDraft({ ...draft, fresh: false, opened: draft.value })
  }

  const remove = async () => {
    if (!draft || draft.fresh) return
    const res = await deleteCatalogEntry(catalog, draft.key)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Deleted ${spec.nameOf(draft.value)}.`)
    setDraft(null)
  }

  return { label: spec.label, groups, draft, open, create, edit, save, remove } as const
}
