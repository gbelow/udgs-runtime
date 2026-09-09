import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES, surgeKinds } from "../../tables"

export function getUsedSurge(c: CampaignCharacter): SurgeKind | null {
  return c.usedSurge
}

// combat.tex "Action surge": one per round, so a surge already spent closes all
// four. Past that each kind has its own price — 3 STA for movement, combat and
// reaction, 1 for focus — so the affordable set is not uniform.
export function canSurge(kind: SurgeKind): (c: CampaignCharacter) => boolean {
  return (c: CampaignCharacter) => c.usedSurge === null && SURGES[kind].STA <= c.resources.STA
}

// View getter: which surge buttons are live, as a flat record of primitives the
// store selector can shallow-compare.
export function getSurgeAvailability(c: CampaignCharacter): Record<SurgeKind, boolean> {
  const availability = {} as Record<SurgeKind, boolean>
  for (const kind of surgeKinds) {
    availability[kind] = canSurge(kind)(c)
  }
  return availability
}
