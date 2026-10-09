import type { SceneState } from '../types'
import { getSenseReaches, type SenseReach } from '../rules/detection'

export type Sighting = { observerId: string; targetId: string; reaches: SenseReach[] }

// Who takes in whom: every observer and target in the fight, one way, that
// some sense of the observer reaches.
export function getSightings(state: SceneState): Sighting[] {
  const ids = Object.keys(state.characters)
  return ids.flatMap((observerId) =>
    ids.flatMap((targetId) => {
      const reaches = getSenseReaches(state, observerId, targetId)
      return reaches.length > 0 ? [{ observerId, targetId, reaches }] : []
    }),
  )
}
