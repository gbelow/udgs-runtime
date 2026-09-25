import type { CampaignCharacter, Item } from '../../types'
import type { CombatState } from '../types'

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
export function findHeldItem(state: CombatState, itemId: string): { holder: CampaignCharacter; item: Item } | null {
  if (!itemId) return null
  for (const holder of Object.values(state.characters)) {
    const item = holder.held.find((i) => i.id === itemId)
    if (item) return { holder, item }
  }
  return null
}
