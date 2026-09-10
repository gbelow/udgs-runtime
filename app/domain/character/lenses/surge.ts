import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { surgeKinds } from "../../lists"

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

export type SurgeOption = {
  kind: SurgeKind
  // combat.tex "Action surge" — price and restriction, already written out. The
  // component shows this string; it does not assemble it from the table.
  title: string
  available: boolean
  used: boolean
}

export function getSurgeOptions(c: CampaignCharacter): SurgeOption[] {
  return surgeKinds.map((kind) => ({
    kind,
    title: `${SURGES[kind].STA} STA for ${SURGES[kind].AP} AP. ${SURGES[kind].restriction}`,
    available: canSurge(kind)(c),
    used: c.usedSurge === kind,
  }))
}
