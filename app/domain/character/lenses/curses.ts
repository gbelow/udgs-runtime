import type { AfflictionKey, Character, Skills } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'
import { skillTermGetters } from './skills'
import { Term, sumTerms } from './terms'

// spells.tex "Curse": the curses the character carries, read as permissively
// as the wounds — an entry whose spell the catalog no longer has is skipped.
export type CarriedCurse = { key: string; DL: number }

export function getCurses(c: Character): CarriedCurse[] {
  if (!isCampaignCharacter(c)) return []
  return c.active
    .filter((entry) => entry?.kind === 'curse' && isSpellKey(entry.key))
    .map((entry) => ({ key: entry.key, DL: entry.DL ?? 0 }))
}

// What the curses do to the sheet: every affliction the spell locks on, for
// as long as it is carried.
export function getCurseAfflictions(c: Character): AfflictionKey[] {
  return getCurses(c).flatMap(({ key }) =>
    isSpellKey(key) ? SPELLS[key].effects.flatMap((e) => (e.duration === 'locked' && e.type === 'affliction' ? [e.effect.key] : [])) : [])
}

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
