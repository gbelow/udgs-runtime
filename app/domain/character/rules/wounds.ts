import type { AfflictionKey, Character, Wound } from '../../types'
import { WOUNDS } from '../../tables'
import { isCampaignCharacter } from '../../utils'

// combat.tex "Wounds": the wounds the character carries.
export function getWounds(c: Character): Wound[] {
  return isCampaignCharacter(c) ? c.injuries.wounds : []
}

// What the wounds do past the part they took: each one's affliction, for as
// long as it is carried.
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
