import { CampaignCharacter, Cost } from "../../types"
import { updateSTA } from "./bleed"

// Takes a price out of the character. STA goes through updateSTA so a
// character who cannot pay bleeds for it like any other STA loss. ET is not
// charged here — the exploration loop owns that clock.
export function payCost(cost: Cost): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (cost.AP === 0 && cost.STA === 0 && cost.exhaustion === 0 && cost.IL === 0) return c
    const paid = updateSTA(c.resources.STA - cost.STA)(c)
    return {
      ...paid,
      resources: { ...paid.resources, AP: paid.resources.AP - cost.AP, exhaustion: paid.resources.exhaustion + cost.exhaustion },
      injuries: { ...paid.injuries, injuryLevel: paid.injuries.injuryLevel + cost.IL },
    }
  }
}
