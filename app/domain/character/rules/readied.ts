import type { Character } from '../../types'
import { SURGES, type Surge, type SurgeUse } from '../../tables'
import { isCampaignCharacter } from '../../utils'

// combat.tex "Focus surge": whether the surge made this round readies the
// character for the use.
export function isReadied(c: Character, use: SurgeUse): boolean {
  if (!isCampaignCharacter(c) || c.usedSurge === null) return false
  const surge: Surge = SURGES[c.usedSurge]
  return surge.readies?.includes(use) ?? false
}
