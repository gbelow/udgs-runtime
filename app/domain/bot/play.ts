import type { SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { stepBot } from './step'
import type { Party } from './party'

// The bots play until they have nothing more to do: the table is waiting on
// someone else, or the parties are done for the round. `limit` bounds a fight
// that would otherwise never hand the table back.
export function playBot(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string, limit = 200): SceneState {
  let current = state
  for (let i = 0; i < limit; i++) {
    const next = stepBot(current, parties, dice, newId)
    if (!next) return current
    current = next
  }
  return current
}
