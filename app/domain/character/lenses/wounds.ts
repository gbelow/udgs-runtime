import type { Character } from '../../types'
import { getPartWound, getWounds } from '../rules/wounds'

// A carried wound as the injury board reads it: what it is, the part it
// took, what it does in the part's words, and the IL wound still to heal.
export type WoundRow = {
  index: number
  name: string
  part: string
  consequence: string
  IL: number
}

export function getWoundRows(c: Character): WoundRow[] {
  return getWounds(c).map((w, index) => ({
    index,
    name: w.name,
    part: c.body.find((p) => p.id === w.part)?.name ?? w.part,
    consequence: getPartWound(c, w)?.consequence ?? '',
    IL: w.IL,
  }))
}

export function getWoundDigest(rows: WoundRow[]): string {
  return rows.map((r) => `${r.index}/${r.name}/${r.part}/${r.IL}`).join('|')
}
