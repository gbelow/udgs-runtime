import { useState } from 'react'
import { toast } from 'sonner'
import { deleteAbilityFamily, saveAbilityFamily } from '../actions'
import { ABILITY_FAMILIES } from '../domain/abilities'
import { AbilityFamilySchema, AbilityFamilyInput } from '../domain/types'
import { slug } from '../domain/utils'
import { emptyValue } from '../forms/schemaFields'

export type AbilityDraft = { key: string; value: AbilityFamilyInput; fresh: boolean }

// The ability catalog as the editor sees it: the families on disk, a draft
// being edited, and the two writes. The catalog itself is a module constant
// imported from app/assets, so a saved edit reaches the app when the dev
// server reloads that module; the draft is what the form holds meanwhile.
export function useAbilityCatalog() {
  const [draft, setDraft] = useState<AbilityDraft | null>(null)

  const families = Object.entries(ABILITY_FAMILIES).map(([key, family]) => ({ key, family: family.family, section: family.section }))

  const open = (key: string) => {
    const family = ABILITY_FAMILIES[key as keyof typeof ABILITY_FAMILIES]
    if (family) setDraft({ key, value: structuredClone(family), fresh: false })
  }

  const create = () => {
    setDraft({ key: '', value: emptyValue(AbilityFamilySchema) as AbilityFamilyInput, fresh: true })
  }

  const edit = (value: AbilityFamilyInput) => {
    if (!draft) return
    // a new family is filed under the slug of its name until it is saved
    setDraft({ ...draft, value, key: draft.fresh ? slug(value.family ?? '') : draft.key })
  }

  const save = async () => {
    if (!draft) return
    const res = await saveAbilityFamily(draft.key, draft.value)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Saved ${draft.value.family}.`)
    setDraft({ ...draft, fresh: false })
  }

  const remove = async () => {
    if (!draft || draft.fresh) return
    const res = await deleteAbilityFamily(draft.key)
    if (!res.ok) { toast.error(res.error); return }
    toast.success(`Deleted ${draft.value.family}.`)
    setDraft(null)
  }

  return { families, draft, open, create, edit, save, remove } as const
}
