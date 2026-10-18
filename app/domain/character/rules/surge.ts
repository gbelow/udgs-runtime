import { CampaignCharacter, Character, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { getAGI } from "./characteristics"
import { getBuffBonus } from "./effects"
import { hasAffliction } from "./afflictions"
import { getBled } from "./wounds"
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

// The AP of an earmarked surge that is still unspent: what stands above the
// AP held before it was made. AP spent is taken from the top, so the surge's
// goes first, and one given back lifts it again.
export function getSurgeAPLeft(c: CampaignCharacter): number {
  return c.surgeFloor === null ? 0 : Math.max(0, c.resources.AP - c.surgeFloor)
}

// The character as a surge leaves them, whether or not it is open to them:
// its STA spent and bled for, its AP granted, an earmarked surge's marked off
// from the rest by the AP held before it (`surgeFloor`).
export function getSurged(kind: SurgeKind): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { STA, earmarked } = SURGES[kind]
    const char = getBled(STA)(c)
    return {
      ...char,
      usedSurge: kind,
      runsFree: kind === 'movement',
      surgeFloor: earmarked ? char.resources.AP : char.surgeFloor,
      resources: {
        ...char.resources,
        AP: char.resources.AP + getSurgeAP(kind)(c),
        STA: char.resources.STA - STA,
      },
    }
  }
}

// Whether some surge is still open to the character, whichever kind.
export function canSurgeAtAll(c: CampaignCharacter): boolean {
  return surgeKinds.some((kind) => canSurge(kind)(c))
}

// Whether some surge other than the focus surge is still open to the
// character.
export function canSurgeBesidesFocus(c: CampaignCharacter): boolean {
  return surgeKinds.some((kind) => kind !== 'focus' && canSurge(kind)(c))
}

// Whether the character has AP to spend, or a surge that would give them
// some.
export function hasAPLeft(c: CampaignCharacter): boolean {
  if (c.resources.AP > 0) return true
  return surgeKinds.some((kind) => canSurge(kind)(c) && getSurgeAP(kind)(c) > 0)
}

export type EarmarkedSurge = { [K in SurgeKind]: (typeof SURGES)[K]['earmarked'] extends true ? K : never }[SurgeKind]

function isEarmarked(kind: SurgeKind): kind is EarmarkedSurge {
  return SURGES[kind].earmarked
}

// The earmarked surge whose AP is still unspent, if any: until it runs out
// or ends, only what it allows can be done.
export function getBindingSurge(c: Character): EarmarkedSurge | null {
  if (!isCampaignCharacter(c) || getSurgeAPLeft(c) <= 0 || c.usedSurge === null) return null
  return isEarmarked(c.usedSurge) ? c.usedSurge : null
}

// The reason anything the binding surge does not allow is closed, or null.
export function getSurgeBar(c: Character): string | null {
  const surge = getBindingSurge(c)
  return surge ? `${surge} surge AP left` : null
}
