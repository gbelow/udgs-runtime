import type { AfflictionKey, Character } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'

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
