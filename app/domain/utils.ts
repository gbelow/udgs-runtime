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

// The catalog key a name is filed under: lowercase, runs of anything but
// letters and digits collapsed to one dash. What the extractors used, so
// existing keys keep resolving.
export function slug(name: string): string {
  return name.toLowerCase().replace(/★/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
