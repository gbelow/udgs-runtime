import { getSTARegen } from "../rules/characteristics"
import { getActionCost } from "../rules/actionCosts"
import { CampaignCharacter } from "../../types"
import type { ActionCost } from "../rules/actionCosts"
import { payCost } from "./cost"

// combat.tex "Rest": "recovers STA by an amount equal to STA/4", and "The
// character is allowed to move 4 AP worth of careful movement while
// resting during their own turn" — kept as an allowance careful moves spend
// first. The rest's AP is its action's price, paid when it is taken.
export function restCharacter(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, STA: c.resources.STA + getSTARegen(c), restAP: getActionCost(c, "rest").AP } }
}

// spells.tex "Effortless Spell": "rest while casting a spell. The spell must
// spend the highest between the rest's AP cost and the spell's AP cost" —
// the STA a rest recovers, the AP the rest asks beyond what the cast paid,
// and the careful movement a rest allows (combat.tex "Rest").
export function restWhileCasting(extra: ActionCost): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => restCharacter(payCost(extra)(c))
}

// combat.tex "Rest": "allowed to move 4 AP worth of careful movement while
// resting" — a careful move takes what the rest left before any AP.
export function payCarefulMove(cost: ActionCost): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const fromRest = Math.min(Math.max(0, c.resources.restAP), cost.AP)
    const paid = payCost({ AP: cost.AP - fromRest, STA: cost.STA })(c)
    return fromRest === 0 ? paid : { ...paid, resources: { ...paid.resources, restAP: paid.resources.restAP - fromRest } }
  }
}
