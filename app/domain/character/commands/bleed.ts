import { CampaignCharacter } from "../../types"


export function bleed( amount: number): <C extends CampaignCharacter>(c: C) => C {
  return <C extends CampaignCharacter>(c: C): C => {
    const damage = amount*c.injuries.bleed
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel + damage}}
  }
}

export function updateSTA( newSTA: number): <C extends CampaignCharacter>(c: C) => C {
  return <C extends CampaignCharacter>(c: C): C => {
    const currentSTA = c.resources.STA
    const damage = Math.max(0, currentSTA - newSTA)
    if(damage > 0) return bleed(damage)({...c, resources:{...c.resources, STA: newSTA}})
    return c
  }
}

// combat.tex "Suffocation": "If the character cannot breathe at the beginning
// of a round, they lose 1 STA" — the caller decides that they cannot. It is a
// loss, not STA spent, so it does not bleed, and per "Negative STA" it is the
// one way STA goes below zero.
export function suffocate(c: CampaignCharacter): CampaignCharacter {
  return { ...c, resources: { ...c.resources, STA: c.resources.STA - 1 } }
}
