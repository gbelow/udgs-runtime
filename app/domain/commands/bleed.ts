import { getSTA } from "../selectors/characteristics"
import { CampaignCharacter } from "../types"


export function bleed( amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const damage = amount*c.injuries.hemorrhage
    return {...c, injuries: {...c.injuries, injuryLevel: c.injuries.injuryLevel + damage}}
  }
}