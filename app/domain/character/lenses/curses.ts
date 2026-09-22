import type { Character, Skills } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import { getCurses } from '../rules/curses'
import { skillTermGetters } from '../rules/skills'
import { Term, sumTerms } from '../rules/terms'

// A carried curse as the panel reads it: the spell, and the test that
// beats it.
export type CurseRow = {
  key: string
  name: string
  roll: keyof Skills | null
  DL: number
  terms: Term[]
  total: number
}

export function getCurseRows(c: Character): CurseRow[] {
  return getCurses(c).map(({ key, DL }) => {
    const spell = isSpellKey(key) ? SPELLS[key] : null
    const roll = spell?.effects.find((e) => e.duration === 'locked' && e.resist)?.resist?.roll ?? null
    const terms = roll ? skillTermGetters[roll](c) : []
    return { key, name: spell?.name ?? key, roll, DL, terms, total: sumTerms(terms) }
  })
}

export function getCurseDigest(rows: CurseRow[]): string {
  return rows.map((r) => `${r.key}/${r.roll}/${r.DL}/${r.total}`).join('|')
}
