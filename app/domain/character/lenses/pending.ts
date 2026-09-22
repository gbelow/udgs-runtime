import type { Character, Skills } from '../../types'
import { isCampaignCharacter } from '../../utils'
import { skillTermGetters } from '../rules/skills'
import { Term, sumTerms } from '../rules/terms'

// A delivery waiting on the character's die, as the panel reads it: what
// it is, the test it leaves them, and what they roll it with.
export type PendingRow = {
  index: number
  name: string
  kind: string
  roll: keyof Skills
  DL: number
  terms: Term[]
  total: number
}

export function getPendingRows(c: Character): PendingRow[] {
  if (!isCampaignCharacter(c)) return []
  return c.pending.flatMap((d, index) => {
    if (!d.test) return []
    const terms = skillTermGetters[d.test.roll](c)
    return [{ index, name: d.effect.name, kind: d.effect.type, roll: d.test.roll, DL: d.test.DL, terms, total: sumTerms(terms) }]
  })
}

export function getPendingDigest(rows: PendingRow[]): string {
  return rows.map((r) => `${r.index}/${r.name}/${r.kind}/${r.roll}/${r.DL}/${r.total}`).join('|')
}
