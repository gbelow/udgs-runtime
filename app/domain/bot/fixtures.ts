import { CombatStateSchema, type CombatState } from '../combat/types'
import { makeCampaignCharacter } from '../factories'
import { ItemSchema, type CampaignCharacter } from '../types'
import { holdItem, regripItem } from '../item/commands/hands'

// Fighters and boards for the bots' test and simulator to play with.

export function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 12, STA: 6 } }
}

export function spearman(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id)))
}

export function board(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): CombatState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  return { ...CombatStateSchema.parse({ board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}
