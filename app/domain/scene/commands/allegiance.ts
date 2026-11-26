import type { Updater } from '../types'
import { getAgainstAlliesBar } from '../rules/allegiance'
import { getHeldBackBar } from '../rules/reactions'
import { getOpenAction } from '../rules/log'

// The character may, or may no longer, answer against their own party for
// the rest of the fight (rules/allegiance.ts).
export function setAgainstAllies(id: string, on: boolean): Updater {
  return (state) => {
    if (getAgainstAlliesBar(state, id, on)) return state
    return { ...state, againstAllies: on ? [...state.againstAllies, id] : state.againstAllies.filter((a) => a !== id) }
  }
}

// The character may answer the action waiting for answers against their own
// party, for that action alone, and so comes to answer it.
export function openAgainstAllies(id: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || getHeldBackBar(state, id)) return state
    return { ...state, againstAlliesOnce: { ...state.againstAlliesOnce, [id]: open.id } }
  }
}
