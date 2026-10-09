import type { SceneState, RootAction } from '../types'
import { getReloaded } from './reload'
import { getAttackFacts, getInterruption, getStrikeLanding } from './damage'
import { getThrownItem, getReachableFloor, takeOne } from './floor'
import { getThrownUnit } from './throw'
import { getHoldBackFacts, getManeuverFacts, getReleaseFacts } from './grapple'
import { getDragFacts } from './drag'
import { getExplosionFacts, getExplosionPayload, getTerrainPaint } from './explosion'
import { getCastFacts, getSpellTestFacts, isFailedCast } from './cast'
import { getMoveFacts } from './move'
import { getFallFacts } from './fall'
import { isVoided } from './opportunity'
import { getFireAgainFacts } from './fireAgain'
import { getAreaBreaks, getAttackBreaks } from './breakage'
import { isObjectAttack } from './equipment'

// The armor each character wears is put at risk by what the action's effects
// did to them (gear.tex "Equipment Breakage").
function withBreaks<A extends Extract<RootAction, { kind: 'blast' | 'cast' | 'fireAgain' }>>(state: SceneState, settled: A): A {
  return { ...settled, breaks: getAreaBreaks(state, settled.facts ?? {}, settled.armorRolls) }
}

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
export function getSettled(state: SceneState, open: RootAction): RootAction {
  if (isVoided(state, open)) return { ...open, step: 'done' }
  switch (open.kind) {
    case 'strike': {
      const blow = getAttackFacts(state, open)
      const facts = isObjectAttack(open) ? null : blow
      return { ...open, step: 'done', facts, breaks: getAttackBreaks(state, open, blow), ...getStrikeLanding(state, open, facts) }
    }
    case 'shoot': {
      const blow = getAttackFacts(state, open)
      const facts = isObjectAttack(open) ? null : blow
      return { ...open, step: 'done', facts, breaks: getAttackBreaks(state, open, blow), interruption: getInterruption(state, open, facts), thrown: getThrownItem(state, open) }
    }
    case 'grapple': return { ...open, step: 'done', facts: getManeuverFacts(state, open) }
    case 'rest':
    case 'prepare':
    case 'extinguish': return { ...open, step: 'done' }
    case 'pickUp': {
      const lying = getReachableFloor(state, open.actorId).find((f) => f.item.id === open.itemId)?.item
      return { ...open, step: 'done', picked: lying ? takeOne(lying, open.id) : null }
    }
    case 'throw': return { ...open, step: 'done', thrown: getThrownUnit(state, open) }
    case 'drink': return { ...open, step: 'done', drunk: state.characters[open.actorId]?.held.find((i) => i.id === open.itemId && i.potion !== null) ?? null }
    case 'reload': {
      const actor = state.characters[open.actorId]
      return { ...open, step: 'done', loaded: actor ? getReloaded(actor, open) : null }
    }
    case 'release': return { ...open, step: 'done', facts: getReleaseFacts(state, open) }
    case 'slip':
    case 'feint':
    case 'cut': return { ...open, step: 'done' }
    case 'holdBack': return { ...open, step: 'done', facts: getHoldBackFacts(state, open) }
    case 'drag': return { ...open, step: 'done', facts: getDragFacts(state, open) }
    case 'explosion': return { ...open, step: 'done', effects: getExplosionPayload(state, open)?.effects ?? [] }
    case 'blast': return withBreaks(state, { ...open, step: 'done', facts: getExplosionFacts(state, open, open.spawnedBy), paint: getTerrainPaint(state, open) })
    case 'cast': return withBreaks(state, { ...open, step: 'done', failed: isFailedCast(state, open), facts: getCastFacts(state, open) })
    case 'fireAgain': return withBreaks(state, { ...open, step: 'done', facts: getFireAgainFacts(state, open) })
    case 'spellTest': return { ...open, step: 'done', facts: getSpellTestFacts(state, open) }
    case 'move': return { ...open, step: 'done', facts: getMoveFacts(state, open) }
    case 'fleeFollowUp': return { ...open, step: 'done' }
    case 'fall': return { ...open, step: 'done', facts: getFallFacts(state, open) }
    case 'swimTest': return { ...open, step: 'done' }
  }
}
