import { CampaignCharacter, Cost } from "../../types"
import { updateSTA } from "./bleed"

// Takes a price out of the character. STA goes through updateSTA so a
// character who cannot pay bleeds for it like any other STA loss. ET is not
// charged here — the exploration loop owns that clock. A price of only AP and
// STA, as the fight's are, adds no exhaustion or IL.
export function payCost(cost: Pick<Cost, 'AP' | 'STA'> & Partial<Cost>): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { AP, STA, exhaustion = 0, IL = 0 } = cost
    if (AP === 0 && STA === 0 && exhaustion === 0 && IL === 0) return c
    const paid = updateSTA(c.resources.STA - STA)(c)
    return {
      ...paid,
      resources: { ...paid.resources, AP: paid.resources.AP - AP, exhaustion: paid.resources.exhaustion + exhaustion },
      injuries: { ...paid.injuries, injuryLevel: paid.injuries.injuryLevel + IL },
    }
  }
}
