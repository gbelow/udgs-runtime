import type { Action, CombatState } from '../types'
import { getAttackFacts, getInterruption, getStrikeLanding } from './damage'
import { getThrownItem, getReachableFloor } from './floor'
import { getDisplaceFacts, getDragFacts, getHoldBackFacts, getManeuverFacts, getReleaseFacts } from './grapple'
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
  if (isVoided(state, open)) return { ...open, step: 'done' }
  switch (open.kind) {
    case 'strike': {
      const facts = getAttackFacts(state, open)
      return { ...open, step: 'done', facts, ...getStrikeLanding(state, open, facts) }
    }
    case 'shoot': {
      const facts = getAttackFacts(state, open)
      return { ...open, step: 'done', facts, interruption: getInterruption(state, open, facts), thrown: getThrownItem(state, open) }
    }
    case 'grapple': return { ...open, step: 'done', facts: getManeuverFacts(state, open) }
    case 'pickUp': return { ...open, step: 'done', picked: getReachableFloor(state, open.actorId).find((f) => f.item.id === open.itemId)?.item ?? null }
    case 'release': return { ...open, step: 'done', facts: getReleaseFacts(state, open) }
    case 'holdBack': return { ...open, step: 'done', facts: getHoldBackFacts(state, open) }
    case 'drag': return { ...open, step: 'done', facts: getDragFacts(state, open) }
    case 'displace': return { ...open, step: 'done', facts: getDisplaceFacts(state, open) }
    case 'explosion': return { ...open, step: 'done', facts: getExplosionFacts(state, open), paint: getTerrainPaint(state, open) }
    case 'cast': return { ...open, step: 'done', facts: getCastFacts(state, open) }
    case 'move': return { ...open, step: 'done', facts: getMoveFacts(state, open) }
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
      return { ...open, step: 'done' }
  }
}
