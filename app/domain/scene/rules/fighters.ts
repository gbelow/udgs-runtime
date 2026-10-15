import type { CampaignCharacter, Item } from '../../types'
import type { SceneState } from '../types'
import { findReadyItem } from '../../item/rules/containers'
import { getCarriedItems } from '../../item/rules/items'
import { findFloorItem } from './floor'

// Who in the fight is who: the active character, the name each goes by,
// who holds an item.

// Read-side: which character is active is a pure function of the state that
// holds it, a fight or the party. The domain owns this so commands never need
// to import a store.
export function getActiveCharacter(state: Pick<SceneState, 'characters' | 'activeCharacterId'>): CampaignCharacter | null {
  if (!state.activeCharacterId) return null
  return state.characters[state.activeCharacterId] ?? null
}

// The name a character goes by in the fight, which tells copies of one sheet
// apart, kept once they have left it; empty for anyone never in it.
export function getFightName(state: Pick<SceneState, 'names'>, id: string): string {
  return state.names[id] ?? ''
}

// What the item is called, wherever it lies: with its owner or on the floor;
// empty once it is gone from both.
export function getItemName(state: SceneState, ownerId: string, itemId: string): string {
  const owner = state.characters[ownerId]
  const carried = owner ? [...getCarriedItems(owner), ...(owner.onBack ? [owner.onBack] : [])] : []
  const item = carried.find((i) => i.id === itemId) ?? findFloorItem(state, itemId)?.item
  return item?.name || item?.refId || ''
}

// Who in the fight holds the item named, and what it is; null for anything
// not in someone's hands.
export function findHeldItem(state: SceneState, itemId: string): Found | null {
  return findOnFighter(state, itemId, (c) => c.held.find((i) => i.id === itemId))
}

// Who in the fight has the item named at hand — in their hands or a quick
// slot — and what it is; null for anything not.
export function findReadyObject(state: SceneState, itemId: string): Found | null {
  return findOnFighter(state, itemId, (c) => findReadyItem(c, itemId)?.item)
}

type Found = { holder: CampaignCharacter; item: Item }

function findOnFighter(state: SceneState, itemId: string, find: (c: CampaignCharacter) => Item | undefined): Found | null {
  if (!itemId) return null
  for (const holder of Object.values(state.characters)) {
    const item = find(holder)
    if (item) return { holder, item }
  }
  return null
}
