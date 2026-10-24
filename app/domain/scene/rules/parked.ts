import type { SceneState } from '../types'
import { isCombatStarted } from './started'
import { getPlayingOutBar } from './log'
import { getMembers } from './fighters'
import { isChaseOver, isRunningInChase } from './chase'

// The party the scene follows since a chase was over, while it is still in
// the scene.
function getFollowed(state: SceneState): string | null {
  return state.followed !== null && state.parties[state.followed] ? state.followed : null
}

// Whether the character is parked: the scene follows another party since a
// chase was over, so they stay in it off the grid, out of the rounds, until
// the table follows them (the table's ruling).
export function isParked(state: SceneState, id: string): boolean {
  return isParkedParty(state, state.partyOf[id] ?? '')
}

// Whether the scene follows a party other than this one.
export function isParkedParty(state: SceneState, partyId: string): boolean {
  const followed = getFollowed(state)
  return followed !== null && partyId !== followed
}

// Whether the table picks whom the scene follows: once a chase is over, and
// afterwards while it follows a party with others parked.
export function isFollowOpen(state: SceneState): boolean {
  return state.chase ? isChaseOver(state) : getFollowed(state) !== null
}

// Why the scene cannot follow the party now, or null. Once a chase is over
// the table picks whom the scene follows, ending the chase; later it may
// switch to a parked party, out of combat.
export function getFollowSceneBar(state: SceneState, partyId: string): string | null {
  if (!isFollowOpen(state)) return state.chase ? 'the chase is not over' : 'no chase has ended to follow on from'
  if (!state.parties[partyId]) return 'there is no such party'
  if (getMembers(state, partyId).length === 0) return 'nobody in the party is alive'
  if (!state.chase && getFollowed(state) === partyId) return 'already followed'
  if (!state.chase && isCombatStarted(state)) return 'end the combat first'
  return getPlayingOutBar(state)
}

// Whether the character is off the grid and not to be put on it: running in
// a chase, or parked.
export function isOffGrid(state: SceneState, id: string): boolean {
  return isParked(state, id) || isRunningInChase(state, id)
}
