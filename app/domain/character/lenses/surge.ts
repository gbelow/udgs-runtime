import type { CampaignCharacter, SurgeKind } from '../../types'
import { SURGES } from '../../tables'
import { surgeKinds } from '../../lists'
import { canSurge, getSurgeAP } from '../rules/surge'

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
    title: `${SURGES[kind].STA} STA for ${getSurgeAP(kind)(c)} AP. ${SURGES[kind].restriction}`,
    available: canSurge(kind)(c),
    used: c.usedSurge === kind,
  }))
}
