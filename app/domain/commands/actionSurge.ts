import { getGearPenalties } from "../selectors/gear"
import { CampaignCharacter, Character } from "../types"

export function actionSurge(c: CampaignCharacter): CampaignCharacter {
  const cost = 3 + Math.floor(getGearPenalties(c) / 3)
  if (c.hasActionSurge && c.resources && cost <= c.resources.STA) {
    return {
      ...c,
      hasActionSurge: false,
      resources: {
        ...c.resources,
        STA: c.resources.STA - cost,
        AP: c.resources.AP + 6
      }
    }
  }
  return c
}
