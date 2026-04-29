import { CampaignCharacter } from "../types"


export function bleed( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const damage = amount*c.injuries.hemorrhage
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel + damage}}
  }
}

export function updateSTA( newSTA: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const currentSTA = c.resources.STA
    const damage = Math.max(0, currentSTA - newSTA)
    if(damage > 0) return bleed(damage)({...c, resources:{...c.resources, STA: newSTA}})
    return c
  }
}