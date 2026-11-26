import type { SceneState } from '../types'
import { getAgainstAlliesBar } from '../rules/allegiance'

// The switch that lets the character answer against their own party for the
// rest of the fight (rules/allegiance.ts); null for one in no party.
export type AgainstAlliesView = { on: boolean; bar: string | null }

export function getAgainstAlliesView(state: SceneState, id: string): AgainstAlliesView | null {
  if (state.partyOf[id] === undefined || !state.characters[id]) return null
  const on = state.againstAllies.includes(id)
  return { on, bar: getAgainstAlliesBar(state, id, !on) }
}
