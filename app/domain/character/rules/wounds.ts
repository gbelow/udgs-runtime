import type { AfflictionKey, Character } from '../../types'
import { WOUNDS, WoundKey } from '../../tables'
import { isCampaignCharacter } from '../../utils'

export function isWoundKey(key: string): key is WoundKey {
  return key in WOUNDS
}

export type CarriedWound = { key: WoundKey; part: string | null }

// combat.tex "Wounds": the wounds the character carries, read as permissively
// as the abilities — an entry whose key the table no longer has is skipped.
export function getWounds(c: Character): CarriedWound[] {
  if (!isCampaignCharacter(c)) return []
  return c.active
    .filter((entry) => entry?.kind === 'wound' && isWoundKey(entry.key))
    .map((entry) => ({ key: entry.key as WoundKey, part: entry.part ?? null }))
}

// What the wounds do to the sheet: each one's affliction, for as long as it
// is carried.
export function getWoundAfflictions(c: Character): AfflictionKey[] {
  return getWounds(c).flatMap(({ key }) => {
    const { affliction } = WOUNDS[key]
    return affliction ? [affliction] : []
  })
}

// combat.tex "Wounds": a broken hand is "useless" — the part is not there
// to hold or to fight with while the wound is carried.
export function isPartWounded(c: Character, partId: string): boolean {
  return getWounds(c).some((w) => w.part === partId)
}
