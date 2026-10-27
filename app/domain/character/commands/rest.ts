import { getSTA, getSTARegen } from "../rules/characteristics"
import { CampaignCharacter } from "../../types"
import type { ActionCost } from "../rules/actionCosts"
import { payCost } from "./cost"

// combat.tex "Rest": "recovers STA by an amount equal to STA/3". The rest's
// AP is its action's price, paid when it is taken; the careful movement it
// allows is a move of its own, made while resting (scene/rules/rest.ts).
// It recovers up to the character's STA, and takes nothing from one already
// above it.
export function restCharacter(c: CampaignCharacter): CampaignCharacter {
  const STA = Math.max(c.resources.STA, Math.min(getSTA(c), c.resources.STA + getSTARegen(c)))
  return { ...c, resources: { ...c.resources, STA } }
}

// spells.tex "Effortless Spell": "rest while casting a spell. The spell must
// spend the highest between the rest's AP cost and the spell's AP cost" —
// the STA a rest recovers, and the AP the rest asks beyond what the cast
// paid.
export function restWhileCasting(extra: ActionCost, charged: boolean): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => restCharacter(payCost(extra, charged)(c))
}
