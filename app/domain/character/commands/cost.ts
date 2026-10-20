import { CampaignCharacter, Cost } from "../../types"
import { updateSTA } from "./bleed"
import { gainHunger, gainThirst } from "./heal"

// Takes a price out of the character. STA goes through updateSTA so a
// character who cannot pay bleeds for it like any other STA loss. ET is not
// charged here — the exploration loop owns that clock. A price of only AP and
// STA, as the fight's are, adds no exhaustion or IL. AP and STA are taken
// only once a combat or chase has started (`charged`).
export function payCost(cost: Pick<Cost, 'AP' | 'STA'> & Partial<Cost>, charged: boolean): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { exhaustion = 0, IL = 0, hunger = 0, thirst = 0 } = cost
    const AP = charged ? cost.AP : 0
    const STA = charged ? cost.STA : 0
    if (AP === 0 && STA === 0 && exhaustion === 0 && IL === 0 && hunger === 0 && thirst === 0) return c
    const paid = updateSTA(c.resources.STA - STA)(c)
    return gainThirst(thirst)(gainHunger(hunger)({
      ...paid,
      resources: { ...paid.resources, AP: paid.resources.AP - AP, exhaustion: Math.max(0, paid.resources.exhaustion + exhaustion) },
      injuries: { ...paid.injuries, injuryLevel: paid.injuries.injuryLevel + IL },
    }))
  }
}
