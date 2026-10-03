import { CombatStateSchema, type CombatState } from '../combat/types'
import { makeCampaignCharacter } from '../factories'
import { ItemSchema, type CampaignCharacter } from '../types'
import { holdItem, regripItem } from '../item/commands/hands'
import { addItemToContainer } from '../item/commands/items'
import { putOnFromCatalog } from '../item/commands/containers'
import { getCatalogItem } from '../item/rules/items'

// Fighters and boards for the bots' test and simulator to play with.

export function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 12, STA: 6 } }
}

export function spearman(id: string): CampaignCharacter {
  const spear = ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
  return regripItem(spear.id, 2)(holdItem(spear)(fighter(id)))
}

// A bow in both hands and a quiver of arrows slung on the belt (gear.tex
// "Quiver").
export function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  const arrows = ItemSchema.parse({ id: `${id}-arrows`, name: 'Broadhead Arrow', type: 'ammo', refId: 'Broadhead Arrow', bulk: 0, amount: 20 })
  const quiver = getCatalogItem('Quiver')!
  const belted = putOnFromCatalog(getCatalogItem('Belt')!)(fighter(id))
  const { containers } = addItemToContainer(quiver.id, 'quick', arrows)(addItemToContainer('Belt', 'quick', quiver)(belted))
  return regripItem(bow.id, 2)(holdItem(bow)({ ...fighter(id), containers }))
}

export function board(placements: Record<string, [number, number]>, ...characters: CampaignCharacter[]): CombatState {
  const cells = Object.fromEntries(Object.entries(placements).map(([id, [q, r]]) => [id, { cell: { q, r } }]))
  return { ...CombatStateSchema.parse({ board: { placements: cells } }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}
