import { BaseCharacter, CampaignCharacter, Character } from "./types"

export function isCampaignCharacter( 
  c: Character
): c is CampaignCharacter {
  return c.type === 'campaign'
}

export function isBaseCharacter( 
  c: Character
): c is BaseCharacter {
  return c.type === 'base'
}
