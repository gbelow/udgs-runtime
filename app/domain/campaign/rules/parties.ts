import type { CampaignState } from '../types'
import { getClockOf } from './clock'

// A party's name: the first "Party n" none of these parties has.
export function nextPartyName(parties: Record<string, { name: string }>): string {
  const names = new Set(Object.values(parties).map((p) => p.name))
  let n = 1
  while (names.has(`Party ${n}`)) n++
  return `Party ${n}`
}

// Why the character cannot join the party: time only goes forward, so
// nobody leaves a timeline for an earlier moment of another, and nobody
// slips out of exploration into downtime or back but with their party.
export function getPartyMoveBar(state: CampaignState, id: string, partyId: string): string | null {
  const to = state.parties[partyId]
  if (!to) return 'no such party'
  const sequence = state.parties[state.partyOf[id]]?.sequence
  if (sequence && sequence !== to.sequence) return `${to.name} is in ${to.sequence}`
  const from = getClockOf(state, id)
  return from !== null && to.clock !== null && to.clock < from ? `${to.name} is earlier on its timeline: sync it first` : null
}

// Of the parties someone has just `left`, those nobody is in any more; a
// party made and not yet joined is not among them.
export function getEmptiedParties(partyOf: Record<string, string>, left: readonly (string | undefined)[]): string[] {
  const held = new Set(Object.values(partyOf))
  return left.filter((pid): pid is string => pid !== undefined && !held.has(pid))
}
