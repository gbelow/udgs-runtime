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

// The record with the entry under `id` taken out.
export function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _gone, ...rest } = record
  return rest
}

// The catalog key a name is filed under: lowercase, runs of anything but
// letters and digits collapsed to one dash. What the extractors used, so
// existing keys keep resolving.
export function slug(name: string): string {
  return name.toLowerCase().replace(/★/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Rows gathered under the label `labelOf` gives each, in first-seen order.
export type Group<T> = { label: string; rows: T[] }
export function groupBy<T>(rows: T[], labelOf: (row: T) => string): Group<T>[] {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const label = labelOf(row)
    const group = groups.get(label)
    if (group) group.push(row)
    else groups.set(label, [row])
  }
  return [...groups].map(([label, rows]) => ({ label, rows }))
}
