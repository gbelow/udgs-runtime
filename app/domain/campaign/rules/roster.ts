import type { CampaignState } from '../types'
import { without } from '../../utils'

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
