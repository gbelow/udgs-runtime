import type { SceneState } from '../types'
import { hasGrant } from '../../character/rules/effects'
import { getLeadershipRallyBar } from '../rules/providence'
import { getSocialCost } from '../rules/social'

// abilities.tex "Leadership": the button of a character who has learned it,
// its price, and why it is closed.
export type LeadershipView = { AP: number; bar: string | null }

export function getLeadershipView(state: SceneState, id: string): LeadershipView | null {
  const c = state.characters[id]
  return c && hasGrant(c, 'leadership') ? { AP: getSocialCost(c, 'rally').AP, bar: getLeadershipRallyBar(state, id) } : null
}
