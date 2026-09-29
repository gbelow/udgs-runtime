import { getSTARegen } from "../rules/characteristics"
import { CampaignCharacter } from "../../types"
import type { ActionCost } from "../rules/actionCosts"
import { payCost } from "./cost"

// combat.tex "Rest": "recovers STA by an amount equal to STA/4". The rest's
// AP is its action's price, paid when it is taken; the careful movement it
// allows is a move of its own, made while resting (combat/rules/rest.ts).
export function restCharacter(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, STA: c.resources.STA + getSTARegen(c) } }
}

// spells.tex "Effortless Spell": "rest while casting a spell. The spell must
// spend the highest between the rest's AP cost and the spell's AP cost" —
// the STA a rest recovers, and the AP the rest asks beyond what the cast
// paid.
export function restWhileCasting(extra: ActionCost): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => restCharacter(payCost(extra)(c))
}
