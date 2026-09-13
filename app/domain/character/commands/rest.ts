import { getSTARegen } from "../lenses/characteristics"
import { getActionCost } from "../lenses/actionCosts"
import { CampaignCharacter } from "../../types"
import { getAfflictions } from "../lenses/afflictions"

export function restCharacter(c: CampaignCharacter): CampaignCharacter
 {
  if (!c.resources) {
    return c
  }
  // combat.tex "Suffocation": a character who cannot breathe "cannot Rest".
  if (getAfflictions(c).includes('suffocating')) return c

  // combat.tex "Rest" — cost and recovery both come from the lens.
  const newSTA = c.resources.STA + getSTARegen(c)
  const newAP = c.resources.AP - getActionCost(c, "rest").AP

  return {
    ...c,
    resources: {
      ...c.resources,
      STA: newSTA,
      AP: newAP,
    }
  }
}