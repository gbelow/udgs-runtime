import type { AfflictionKey, Character } from '../../types'
import { AFFLICTIONS, AFFLICTION_CATEGORIES, AfflictionCategory } from '../../tables'
import { combineAfflictions, getForcedAfflictions, getStoredAfflictions } from '../rules/afflictions'

export type AfflictionRow = {
  key: AfflictionKey
  // Whether a click can change the affliction. The rungs survival.tex derives
  // from hunger, thirst and exhaustion are owned by their resource, and one
  // something besides the hand keeps on cannot be switched off.
  controlable: boolean
  active: boolean
}

type Rung = AfflictionRow & { forced: boolean }

// Every affliction with whether it is on, and whether it is on whatever the
// hand set: by the character's own state or by what their surroundings put
// on them.
function getRungs(c: Character, situational: readonly AfflictionKey[]): Rung[] {
  const forced = new Set([...getForcedAfflictions(c), ...situational])
  const active = new Set(combineAfflictions(getStoredAfflictions(c), forced))
  return (Object.keys(AFFLICTIONS) as AfflictionKey[]).map((key) => ({
    key,
    controlable: AFFLICTIONS[key].controlable,
    active: active.has(key),
    forced: forced.has(key),
  }))
}

// Every affliction the UI can offer, with its current state on this character —
// the whole board in one shape, so the component neither indexes the rule table
// nor decides what "active" means. `situational` is what the character's
// surroundings put on them besides, which the character alone cannot tell.
export function getAfflictionRows(c: Character, situational: readonly AfflictionKey[] = []): AfflictionRow[] {
  return getRungs(c, situational).map(({ key, controlable, active, forced }) => ({ key, controlable: controlable && !forced, active }))
}

// One control per affliction, where a severity ladder is one control that
// shows only the rung the character is on. `label` is that rung, or the
// ladder's name when the character is on none. `toggle` is the key a click
// hands to `addAffliction`: the rung above the current one, or the current one
// itself at the top so the click switches the ladder off. A standalone
// affliction is a ladder of one rung, so it toggles itself. A click may step
// a ladder up past what something besides the hand keeps on, never off it.
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
export function getAfflictionBoard(c: Character, situational: readonly AfflictionKey[] = []): AfflictionSection[] {
  const ladders = new Map<string, Rung[]>()
  for (const row of getRungs(c, situational)) {
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
      controlable: rungs[0].controlable && !(toggle === current && current.forced),
      toggle: toggle.key,
    }]
  })
  return AFFLICTION_CATEGORIES.map((category) => ({
    category,
    entries: entries.filter(([cat]) => cat === category).map(([, entry]) => entry),
  }))
}
