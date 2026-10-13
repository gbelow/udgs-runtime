import { CampaignCharacter, Cost } from "../../types"

// Whether the price can be met out of the pools it draws on right now. Only
// AP and STA are pools; exhaustion and IL accrue and ET is spent by the
// exploration loop, so none of those can refuse. A surge's AP is part of AP:
// while any is left only what the surge allows is open, so whatever asks is
// something it may pay for. A price that takes no AP is met however far a
// rest has overdrawn them (combat.tex "Rest"). Only a combat or chase that
// has started charges AP and STA (`charged`); before it and away from it
// they are not asked.
export function canAfford(c: CampaignCharacter, cost: Pick<Cost, 'AP' | 'STA'>, charged: boolean): boolean {
  return !charged || ((cost.AP <= 0 || c.resources.AP >= cost.AP) && c.resources.STA >= cost.STA)
}

// combat.tex "Concentration": an action that requires concentration, which
// "Focus surge is necessary to sustain", may be held over to the next round
// when there is not the AP for it now — the STA it takes paid at once.
export function canHold(c: CampaignCharacter, cost: Pick<Cost, 'AP' | 'STA'>): boolean {
  return c.usedSurge === 'focus' && c.resources.STA >= cost.STA
}

// What a concentration action asks of the one who would make it: the AP for
// it, or the means to hold it.
export function canAffordOrHold(c: CampaignCharacter, cost: Pick<Cost, 'AP' | 'STA'>, charged: boolean): boolean {
  return canAfford(c, cost, charged) || canHold(c, cost)
}
