import { CampaignCharacter, Character, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { getAGI } from "./characteristics"
import { getBuffBonus } from "./effects"
import { hasAffliction } from "./afflictions"
import { isCampaignCharacter } from "../../utils"
import { surgeKinds } from "../../lists"

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
// creating.tex "Limit Stress Actions": a surge the limit stress action
// compels is made under the affliction that would forbid it (the table's
// ruling: a violent character surges for combat while afraid).
export function canSurge(kind: SurgeKind, compelled = false): (c: CampaignCharacter) => boolean {
  return (c: CampaignCharacter) => {
    const surge = SURGES[kind]
    if (c.usedSurge !== null || surge.STA > c.resources.STA) return false
    return compelled || !('forbiddenBy' in surge) || !hasAffliction(c, surge.forbiddenBy)
  }
}

// Whether some surge is still open to the character, whichever kind.
export function canSurgeAtAll(c: CampaignCharacter): boolean {
  return surgeKinds.some((kind) => canSurge(kind)(c))
}

// Whether the character has AP to spend, or a surge that would give them
// some.
export function hasAPLeft(c: CampaignCharacter): boolean {
  if (c.resources.AP > 0 || c.resources.surgeAP > 0) return true
  return surgeKinds.some((kind) => canSurge(kind)(c) && getSurgeAP(kind)(c) > 0)
}

export type EarmarkedSurge = { [K in SurgeKind]: (typeof SURGES)[K]['earmarked'] extends true ? K : never }[SurgeKind]

function isEarmarked(kind: SurgeKind): kind is EarmarkedSurge {
  return SURGES[kind].earmarked
}

// The earmarked surge whose AP is still unspent, if any: until it runs out
// or ends, only what it allows can be done.
export function getBindingSurge(c: Character): EarmarkedSurge | null {
  if (!isCampaignCharacter(c) || c.resources.surgeAP <= 0 || c.usedSurge === null) return null
  return isEarmarked(c.usedSurge) ? c.usedSurge : null
}

// The reason anything the binding surge does not allow is closed, or null.
export function getSurgeBar(c: Character): string | null {
  const surge = getBindingSurge(c)
  return surge ? `${surge} surge AP left` : null
}
