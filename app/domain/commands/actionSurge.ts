import { getGearPenalties } from "../selectors/gear"
import { CampaignCharacter } from "../types"
import { bleed } from "./bleed"

export function actionSurge(c: CampaignCharacter): CampaignCharacter {
  const cost = 3 + Math.floor(getGearPenalties(c) / 3)
  if (c.hasActionSurge && c.resources && cost <= c.resources.STA) {
    const char = bleed(cost)(c)
    return {
      ...char,
      hasActionSurge: false,
      resources: {
        ...char.resources,
        AP: c.resources.AP + 6,
        STA: char.resources.STA - cost,
      }
    }
  }
  return c
}
