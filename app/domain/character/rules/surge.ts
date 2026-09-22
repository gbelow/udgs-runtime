import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { getAGI } from "./characteristics"
import { getBuffBonus } from "./effects"
import { getAfflictions } from "./afflictions"

export function getUsedSurge(c: CampaignCharacter): SurgeKind | null {
  return c.usedSurge
}

// combat.tex "Action surge": the movement surge yields AGI/2 AP, the others a
// flat amount. AGI here is the full characteristic — the injury exclusion in
// "Afflictions" covers movement speeds, not the surge.
export function getSurgeAP(kind: SurgeKind): (c: CampaignCharacter) => number {
  return (c: CampaignCharacter) => SURGES[kind].AP(getAGI(c)) + getBuffBonus(c, `surge:${kind}`)
}

// combat.tex "Action surge": one per round, so a surge already spent closes all
// four. Past that each kind has its own price — 3 STA for movement, combat and
// reaction, 1 for focus — so the affordable set is not uniform. A surge is
// also closed by the affliction that forbids it (afraid / enraged); the
// derived set is read so a forced state counts the same as a hand-set one.
export function canSurge(kind: SurgeKind): (c: CampaignCharacter) => boolean {
  return (c: CampaignCharacter) => {
    const surge = SURGES[kind]
    if (c.usedSurge !== null || surge.STA > c.resources.STA) return false
    return !('forbiddenBy' in surge) || !getAfflictions(c).includes(surge.forbiddenBy)
  }
}
