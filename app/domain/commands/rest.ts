import { CampaignCharacter, Character } from "../types"

export function restCharacter(c: CampaignCharacter): CampaignCharacter
 {
  if (!c.resources) {
    return c
  }

  const newSTA = c.resources.STA + Math.floor(c.characteristics.STA / 4)
  const newAP = c.resources.AP - 4

  return {
    ...c,
    resources: {
      ...c.resources,
      STA: newSTA,
      AP: newAP,
    }
  }
}