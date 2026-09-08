import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"

export function getUsedSurge(c: CampaignCharacter): SurgeKind | null {
  return c.usedSurge
}

// combat.tex "Action surge": one per round, so a surge already spent closes all
// four. Past that it is only a question of affording the STA.
export function canSurge(kind: SurgeKind): (c: CampaignCharacter) => boolean {
  return (c: CampaignCharacter) => c.usedSurge === null && SURGES[kind].STA <= c.resources.STA
}
