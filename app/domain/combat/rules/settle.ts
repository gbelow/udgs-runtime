import type { Action, CombatState } from '../types'
import { getAttackFacts, getInterruption, getStrikeLanding } from './damage'
import { getThrownItem, getReachableFloor } from './floor'
import { getDragFacts, getHoldBackFacts, getManeuverFacts, getReleaseFacts } from './grapple'
import { getExplosionFacts, getTerrainPaint } from './explosion'
import { getCastFacts } from './cast'
import { getMoveFacts } from './move'
import { isVoided } from './opportunity'

// The action as it lands: closed, with what it came to written down per
// kind, read off the state as it stands. The resolve writes exactly this,
// and every preview reads it, so what is shown before the resolve is what
// the resolve does. A cancelled one comes to nothing. A strike or a shot has
// its attacker's side written down, so the record says what landed and the
// target's reducer needs nothing but the action, and what it did to the
// target's own action beside it, for the move it may have cut short or the
// one an evasion may open. An explosion writes down what reaches everyone in
// its area as the board stands, once every escape has been played out and it
// is pointed where it goes off.
export function getSettled(state: CombatState, open: Action): Action {
  if (isVoided(state, open) && 'cancelled' in open) return { ...open, status: 'resolved', cancelled: true }
  switch (open.kind) {
    case 'strike': {
      const facts = getAttackFacts(state, open)
      return { ...open, status: 'resolved', facts, ...getStrikeLanding(state, open, facts) }
    }
    case 'shoot': {
      const facts = getAttackFacts(state, open)
      return { ...open, status: 'resolved', facts, interruption: getInterruption(state, open, facts), thrown: getThrownItem(state, open) }
    }
    case 'grapple': return { ...open, status: 'resolved', facts: getManeuverFacts(state, open) }
    case 'pickUp': return { ...open, status: 'resolved', picked: getReachableFloor(state, open.actorId).find((f) => f.item.id === open.itemId)?.item ?? null }
    case 'release': return { ...open, status: 'resolved', facts: getReleaseFacts(state, open) }
    case 'holdBack': return { ...open, status: 'resolved', facts: getHoldBackFacts(state, open) }
    case 'drag': return { ...open, status: 'resolved', facts: getDragFacts(state, open) }
    case 'explosion': return { ...open, status: 'resolved', facts: getExplosionFacts(state, open), paint: getTerrainPaint(state, open) }
    case 'cast': return { ...open, status: 'resolved', facts: getCastFacts(state, open) }
    case 'move': return { ...open, status: 'resolved', facts: getMoveFacts(state, open) }
    // reactions: settled with their root, nothing of their own to write
    case 'evade':
    case 'evasiveJump':
    case 'block':
    case 'intercept':
    case 'evasion':
    case 'guard':
    case 'avoidExplosion':
    case 'opportunityAttack':
    case 'follow':
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo':
      return { ...open, status: 'resolved' }
  }
}
