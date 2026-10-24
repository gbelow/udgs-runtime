import type { Updater } from '../types'
import type { Throw } from '../../play/calls'
import { calling } from './calling'
import { endScene } from './endCombat'
import { withoutPlacements } from '../rules/board/board'
import { getFollowSceneBar } from '../rules/parked'

// The scene follows the party (the table's ruling). Once a chase is over,
// the chase and the combat end there with everyone staying in the scene;
// everyone in any other party is parked, off the grid, and the party
// followed is put on it by hand.
export function followScene(partyId: string, thrown: Throw): Updater {
  return calling({ kind: 'followScene', partyId }, thrown, (caller) => (state) => {
    if (getFollowSceneBar(state, partyId)) return state
    const ended = state.chase ? endScene(state, caller) : state
    const parked = Object.keys(ended.characters).filter((id) => ended.partyOf[id] !== partyId)
    return withoutPlacements({ ...ended, followed: partyId }, parked)
  })
}
