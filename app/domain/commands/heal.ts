import { CampaignCharacter } from "../types"


export function heal( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const newHunger = c.resources.hunger + amount
    const newThirst = c.resources.thirst + amount
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel - amount}, resources: {...c.resources, hunger:  newHunger, thirst: newThirst}}
  }
}