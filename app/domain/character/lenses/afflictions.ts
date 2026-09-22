import type { AfflictionKey, Character } from '../../types'
import { AFFLICTIONS, AFFLICTION_CATEGORIES, AfflictionCategory } from '../../tables'
import { getAfflictions } from '../rules/afflictions'

export type AfflictionRow = {
  key: AfflictionKey
  // Whether the affliction can be toggled by hand. The rungs survival.tex
  // derives from hunger, thirst and exhaustion are owned by their resource.
  controlable: boolean
  active: boolean
}

// Every affliction the UI can offer, with its current state on this character —
// the whole board in one shape, so the component neither indexes the rule table
// nor decides what "active" means.
export function getAfflictionRows(c: Character): AfflictionRow[] {
  const active = new Set(getAfflictions(c))
  return (Object.keys(AFFLICTIONS) as AfflictionKey[]).map((key) => ({
    key,
    controlable: AFFLICTIONS[key].controlable,
    active: active.has(key),
  }))
}

// One control per affliction, where a severity ladder is one control that
// shows only the rung the character is on. `label` is that rung, or the
// ladder's name when the character is on none. `toggle` is the key a click
// hands to `addAffliction`: the rung above the current one, or the current one
// itself at the top so the click switches the ladder off. A standalone
// affliction is a ladder of one rung, so it toggles itself.
export type AfflictionEntry = {
  name: string
  label: string
  active: boolean
  controlable: boolean
  toggle: AfflictionKey
}

export type AfflictionSection = {
  category: AfflictionCategory
  entries: AfflictionEntry[]
}

// The board sectioned by heading. A ladder sits under the category of its
// lowest rung.
export function getAfflictionBoard(c: Character): AfflictionSection[] {
  const ladders = new Map<string, AfflictionRow[]>()
  for (const row of getAfflictionRows(c)) {
    const name = AFFLICTIONS[row.key].group ?? row.key
    ladders.set(name, [...(ladders.get(name) ?? []), row])
  }
  const entries = [...ladders.entries()].map(([name, rungs]): [AfflictionCategory, AfflictionEntry] => {
    rungs.sort((a, b) => (AFFLICTIONS[a.key].rank ?? 0) - (AFFLICTIONS[b.key].rank ?? 0))
    const at = rungs.findIndex((r) => r.active)
    const current = rungs[at] ?? null
    const toggle = at < 0 ? rungs[0] : (rungs[at + 1] ?? current)
    return [AFFLICTIONS[rungs[0].key].category, {
      name,
      label: current?.key ?? name,
      active: current !== null,
      controlable: rungs[0].controlable,
      toggle: toggle.key,
    }]
  })
  return AFFLICTION_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter(([cat]) => cat === category).map(([, entry]) => entry),
  }))
}
