import type { CampaignCharacter, Item } from '../../types'
import type { CombatState } from '../types'
import { findReadyItem } from '../../item/rules/containers'

// Who in the fight is who: the active character, the name each goes by,
// who holds an item.

// Read-side: which character is active is a pure function of combat state.
// The domain owns this so combat commands never need to import CombatStore.
export function getActiveCharacter(state: CombatState): CampaignCharacter | null {
  if (!state.activeCharacterId) return null
  return state.characters[state.activeCharacterId] ?? null
}

// The name a character goes by in the fight, which tells copies of one sheet
// apart; empty for anyone not in it.
export function getFightName(state: CombatState, id: string): string {
  return state.characters[id]?.fightName ?? ''
}

// Who in the fight holds the item named, and what it is; null for anything
// not in someone's hands.
export function findHeldItem(state: CombatState, itemId: string): Found | null {
  return findOnFighter(state, itemId, (c) => c.held.find((i) => i.id === itemId))
}

// Who in the fight has the item named at hand — in their hands or a quick
// slot — and what it is; null for anything not.
export function findReadyObject(state: CombatState, itemId: string): Found | null {
  return findOnFighter(state, itemId, (c) => findReadyItem(c, itemId)?.item)
}

type Found = { holder: CampaignCharacter; item: Item }

function findOnFighter(state: CombatState, itemId: string, find: (c: CampaignCharacter) => Item | undefined): Found | null {
  if (!itemId) return null
  for (const holder of Object.values(state.characters)) {
    const item = find(holder)
    if (item) return { holder, item }
  }
  return null
}
