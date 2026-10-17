import type { CampaignState } from '../types'
import type { CampaignCharacter } from '../../types'
import { without } from '../../utils'
import { addInstance } from '../../instances'

// Every id the campaign has given: on the roster, kept in a party while away,
// or lent to a fight.
export function getCampaignIds(state: CampaignState): string[] {
  return [...Object.keys(state.characters), ...Object.keys(state.partyOf), ...state.lent]
}

// The character under an id the campaign has not given to anyone else: their
// own, or a fresh one.
export function withFreeId(state: CampaignState, char: CampaignCharacter, newId: () => string): CampaignCharacter {
  return addInstance(char, newId, getCampaignIds(state))
}

// The name the character goes by on the roster, which tells copies of one
// sheet apart: the one the campaign gave them, or, outside time, their
// sheet's numbered among the copies in their party.
export function getRosterName(state: CampaignState, id: string): string {
  const named = state.names[id]
  if (named) return named
  const c = state.characters[id]
  if (!c) return id
  const copies = Object.values(state.characters).filter((o) => o.name === c.name && !state.names[o.id] && state.partyOf[o.id] === state.partyOf[id])
  const n = copies.findIndex((o) => o.id === id)
  return n > 0 ? c.name + (n + 1) : c.name
}

// Every name the campaign has given but the character's own, which nobody
// else at the table may go by.
export function getTableNames(state: CampaignState, except?: string): string[] {
  return Object.values(except ? without(state.names, except) : state.names)
}
