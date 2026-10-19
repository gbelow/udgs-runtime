import type { Updater } from '../types'
import { getFollowBar } from '../rules/follow'

// The character marks whom they follow, or, with no one, takes the mark back;
// a new mark replaces the old.
export function follow(id: string, targetId: string | null): Updater {
  return (state) => {
    if (targetId === null) {
      if (!(id in state.following)) return state
      const { [id]: _, ...rest } = state.following
      return { ...state, following: rest }
    }
    if (getFollowBar(state, id, targetId)) return state
    return { ...state, following: { ...state.following, [id]: targetId } }
  }
}
