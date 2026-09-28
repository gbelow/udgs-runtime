import { getSTARegen } from "../rules/characteristics"
import { getActionCost } from "../rules/actionCosts"
import { CampaignCharacter } from "../../types"
import { hasAffliction } from "../rules/afflictions"
import { getSurgeBar } from "../rules/surge"

export function restCharacter(c: CampaignCharacter): CampaignCharacter
 {
  if (!c.resources) {
    return c
  }
  // combat.tex "Suffocation": a character who cannot breathe "cannot Rest".
  if (hasAffliction(c, 'suffocating')) return c
  // combat.tex "Action surge": resting is nothing a surge's AP allows
  if (getSurgeBar(c)) return c

  // combat.tex "Rest" — cost and recovery both come from the lens.
  const newSTA = c.resources.STA + getSTARegen(c)
  const newAP = c.resources.AP - getActionCost(c, "rest").AP

  return {
    ...c,
    resources: {
      ...c.resources,
      STA: newSTA,
      AP: newAP,
    }
  }
}