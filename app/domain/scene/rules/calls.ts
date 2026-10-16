import type { SceneState } from '../types'
import { getAction, getOpeningReaction } from './log'
import { getContenders } from './turn'

// What the GM takes back to free the scene of a die nobody throws: the action
// or reaction the die was called for (with its reactions, and the reaction
// that opened it), or a contender's ask for the turn. Null for a die that
// answers nothing anyone declared — a target's test, a climb's, the round's
// stealth, finishing held actions, the holder's cunning — which the GM can
// only roll for.
export type Cancelling = { kind: 'actions'; ids: string[]; spawned: boolean } | { kind: 'contender'; id: string }

export function getCancelling(state: SceneState, callId: string): Cancelling | null {
  if (!(callId in state.calls)) return null
  const [kind, id] = callId.split(':')
  if (kind === 'contest') return getContenders(state).includes(id) ? { kind: 'contender', id } : null
  if (kind !== 'roll') return null
  const action = getAction(state, id)
  if (!action || !state.live.includes(id)) return null
  if (action.reactionTo !== null) return { kind: 'actions', ids: [id], spawned: false }
  const opener = action.spawnedBy ? getOpeningReaction(state, action) : null
  return { kind: 'actions', ids: opener ? [id, opener.id] : [id], spawned: action.spawnedBy !== null }
}
