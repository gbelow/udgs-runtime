import type { Action, RootAction, SceneState } from '../types'
import { isRootAction } from './actionCatalog'
import { getAction, getLiveActions } from './log'
import { isConcentrationAbility } from './medicine'

// combat.tex "Concentration", "Focus surge": the actions that need the focus
// surge, draw opportunity attacks as a triggering action, and may be held over
// to the next round when there is not the AP for them now.
export function requiresConcentration(action: Action): boolean {
  switch (action.kind) {
    case 'shoot':
    case 'reload':
      return true
    case 'cast':
      return !action.quicken
    case 'firstAid':
    case 'cauterize':
      return isConcentrationAbility(action.kind)
    default:
      return false
  }
}

// The actions held over for the round to change.
export function getHeldActions(state: SceneState): RootAction[] {
  return getLiveActions(state).filter((a): a is RootAction => a.step === 'held' && isRootAction(a))
}

// What the character is concentrating on; a character holds one action at a
// time (combat.tex "Actions": "Only one action can be done at a time").
export function getHeldOf(state: SceneState, actorId: string): RootAction | null {
  for (const id of state.live) {
    const a = state.actions[id]
    if (a.step === 'held' && a.actorId === actorId && isRootAction(a)) return a
  }
  return null
}

// combat.tex "Interruption": whether a reaction by the character to the
// action being fought would interrupt the action they hold: the first they
// make does, and it is that one only that is given up for. A reaction taken
// back gives up nothing.
export function isGivingUpHeld(state: SceneState, reactorId: string, foughtId: string): boolean {
  const held = getHeldOf(state, reactorId)
  return held !== null && givesUpFor(state, held, foughtId)
}

function givesUpFor(state: SceneState, held: Action, foughtId: string): boolean {
  const given = held.reactedWithin.map((id) => getAction(state, id)).find((a) => a !== null)
  return given === undefined || given.reactionTo === foughtId
}

// combat.tex "Interruption": "The AP from the interrupted action is
// refunded, but 1 AP is lost" — what the held action had been paid.
export function getHeldRefund(state: SceneState, reactorId: string, foughtId: string): number {
  const held = getHeldOf(state, reactorId)
  return held && givesUpFor(state, held, foughtId) ? Math.max(0, held.carried.AP - 1) : 0
}
