import { CampaignCharacter } from "../types"


export function heal( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const potionDiscount = Math.min(c.injuries.potion, amount)
    const newHunger = c.resources.hunger + amount - potionDiscount
    const newThirst = c.resources.thirst + amount - potionDiscount
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel - amount, potion: c.injuries.potion - potionDiscount}, resources: {...c.resources, hunger:  newHunger, thirst: newThirst}}
  }
}

export function updateIL( newIL: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const amount = Math.max(0, c.injuries.injuryLevel - newIL)
    if(amount > 0) return heal(amount)(c)
    return c
  }
}