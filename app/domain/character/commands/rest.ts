import { getSTARegen, REST_AP_COST } from "../lenses/characteristics"
import { CampaignCharacter } from "../../types"

export function restCharacter(c: CampaignCharacter): CampaignCharacter
 {
  if (!c.resources) {
    return c
  }

  // combat.tex "Rest" — cost and recovery both come from the lens.
  const newSTA = c.resources.STA + getSTARegen(c)
  const newAP = c.resources.AP - REST_AP_COST

  return {
    ...c,
    resources: {
      ...c.resources,
      STA: newSTA,
      AP: newAP,
    }
  }
}