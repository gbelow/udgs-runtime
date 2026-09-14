import { CampaignCharacter, Cost } from "../../types"

// Whether the price can be met out of the pools it draws on right now. Only
// AP and STA are pools; exhaustion and IL accrue and ET is spent by the
// exploration loop, so none of those can refuse.
export function canAfford(c: CampaignCharacter, cost: Cost): boolean {
  return c.resources.AP >= cost.AP && c.resources.STA >= cost.STA
}
