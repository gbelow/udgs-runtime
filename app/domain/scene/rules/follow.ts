import type { SceneState } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { isCombatStarted } from './started'
import { isInTurn } from './turn'
import { getFightName } from './fighters'
import { getMeleeDistance, getMeleeRange } from './board/board'

// combat.tex "Follow": "A character can follow another character that is in
// melee range, as a reaction to any movement except running." The table's
// ruling: the follower marks whom they follow in their own turn, for free, and
// the mark holds to the round's end (`state.following`); only the one marked
// can be followed.

// Why the character cannot mark the target now, or null: in their own turn,
// someone else, alive, and already within the melee reach of a weapon they
// can use.
export function getFollowBar(state: SceneState, id: string, targetId: string): string | null {
  const c = state.characters[id]
  const target = state.characters[targetId]
  if (!c || !target || id === targetId) return 'nobody to follow'
  if (!isCombatStarted(state)) return 'combat has not started'
  if (!isInTurn(state, id)) return 'only in your own turn'
  if (isDead(target)) return 'dead'
  const apart = getMeleeDistance(state, id, targetId)
  if (apart === null) return 'not on the board'
  return apart <= getMeleeRange(c) ? null : 'out of melee range'
}

// Who the character may mark, in the fight's order, each with why not.
export function getFollowOptions(state: SceneState, id: string): { id: string; name: string; bar: string | null }[] {
  return Object.keys(state.characters)
    .filter((other) => other !== id)
    .map((other) => ({ id: other, name: getFightName(state, other), bar: getFollowBar(state, id, other) }))
}
