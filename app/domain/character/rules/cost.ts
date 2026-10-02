import { CampaignCharacter, Cost } from "../../types"

// Whether the price can be met out of the pools it draws on right now. Only
// AP and STA are pools; exhaustion and IL accrue and ET is spent by the
// exploration loop, so none of those can refuse. A surge's AP counts: while
// any is left only what the surge allows is open, so whatever asks is
// something it may pay for. A price that takes no AP is met however far a
// rest has overdrawn them (combat.tex "Rest").
export function canAfford(c: CampaignCharacter, cost: Pick<Cost, 'AP' | 'STA'>): boolean {
  return (cost.AP <= 0 || c.resources.AP + c.resources.surgeAP >= cost.AP) && c.resources.STA >= cost.STA
}
