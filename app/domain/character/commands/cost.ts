import { CampaignCharacter, Cost, Resources } from "../../types"
import { updateSTA } from "./bleed"

// Takes a price out of the character. STA goes through updateSTA so a
// character who cannot pay bleeds for it like any other STA loss. ET is not
// charged here — the exploration loop owns that clock. A price of only AP and
// STA, as the fight's are, adds no exhaustion or IL. AP comes out of what a
// surge left first.
export function payCost(cost: Pick<Cost, 'AP' | 'STA'> & Partial<Cost>): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { AP, STA, exhaustion = 0, IL = 0 } = cost
    if (AP === 0 && STA === 0 && exhaustion === 0 && IL === 0) return c
    const paid = updateSTA(c.resources.STA - STA)(c)
    return {
      ...paid,
      resources: { ...paid.resources, ...spendAP(paid.resources, AP), exhaustion: paid.resources.exhaustion + exhaustion },
      injuries: { ...paid.injuries, injuryLevel: paid.injuries.injuryLevel + IL },
    }
  }
}

// AP taken out of the surge's first, then the rest — a price or a loss alike.
export function spendAP(resources: Resources, AP: number): Pick<Resources, 'AP' | 'surgeAP'> {
  const fromSurge = Math.min(Math.max(0, resources.surgeAP), Math.max(0, AP))
  return { surgeAP: resources.surgeAP - fromSurge, AP: resources.AP - (AP - fromSurge) }
}
