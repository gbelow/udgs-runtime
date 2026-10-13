import type { Action, RootAction, SceneState } from '../types'
import type { Dice } from '../../play/dice'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { getFinishBar, getOwnCost } from '../rules/action'
import { getHeldActions, getHeldOf } from '../rules/hold'
import { getAction, getLiveActions, getOpenAction } from '../rules/log'
import { isInterruptedBy } from '../rules/interruption'
import { rollCunning } from '../rules/turn'
import { replaceActions, setActions, withdrawActions } from './log'
import { canAfford } from '../../character/rules/cost'
import { isCombatStarted } from '../rules/started'

// combat.tex "Concentration": an action held over to the next round, in play
// but off the stack, paid as far as its actor's AP went.

// The action committed to be held, once paid and the attacks it drew are
// fought: it waits for the round to change, what it was paid carried.
export function parkHeld(state: SceneState, root: RootAction): SceneState {
  return replaceActions(state, [{ ...root, step: 'held', holding: false, carried: root.cost ?? { AP: 0, STA: 0 } }])
}

// combat.tex "Interruption": an action held over is given up by its actor's
// first reaction, once it is paid.
export function giveUpHeld(state: SceneState, paid: Action[]): SceneState {
  return paid.reduce((s, a) => {
    const held = a.reactionTo !== null ? getHeldOf(s, a.actorId) : null
    return held && held.reactedWithin.includes(a.id) ? withdrawActions(s, [held.id], 'givenUp') : s
  }, state)
}

// combat.tex "Interruption": "All AP and STA costs of the action or movement
// that have already been spent are lost" — an action held over comes to
// nothing when what lands interrupts its actor.
export function breakHeld(state: SceneState, landed: Action): SceneState {
  const broken = getHeldActions(state).filter((h) => isInterruptedBy(state, landed, h.actorId))
  return broken.length === 0 ? state : withdrawActions(state, broken.map((h) => h.id), 'interrupted')
}

// combat.tex "Concentration": the round has changed, or the combat has
// ended, and these held actions' actors let them go to be finished with the
// AP of the new round, or for nothing. Those who have enough finish, in the order of their cunning tests ("make cunning
// tests for all contenders and apply effects from highest to lowest"; alone,
// none is thrown); the others, and whoever can no longer act, come to
// nothing.
export function finishHeld(state: SceneState, ids: string[], dice: Dice): SceneState {
  const finishing: string[] = []
  let s = state
  for (const held of getHeldActions(state).filter((h) => ids.includes(h.id))) {
    const c = s.characters[held.actorId]
    const price = c ? getOwnCost(s, held) : null
    if (!c || !price || isDead(c) || hasAffliction(c, 'unconscious') || !canAfford(c, { AP: price.AP, STA: 0 }, isCombatStarted(s))) s = withdrawActions(s, [held.id], 'failed')
    else finishing.push(held.id)
  }
  return releaseNextHeld(finishing.length === 0 ? s : replaceActions(s, rank(s, finishing, dice)))
}

// combat.tex "Concentration": the actor holds on to the action for another
// round, with the AP they have paid into it.
export function carryOver(state: SceneState, held: RootAction, AP: number): SceneState {
  return replaceActions(state, [{ ...held, carried: { AP: held.carried.AP + AP, STA: held.carried.STA } }])
}

// Those finishing, highest cunning roll first and the one who held first
// before an equal one.
function rank(state: SceneState, ids: string[], dice: Dice): Action[] {
  const held = ids.flatMap((id) => getAction(state, id) ?? [])
  return held
    .map((a) => ({ a, score: held.length > 1 ? rollCunning(state, a.actorId, dice).score : 0 }))
    .sort((x, y) => y.score - x.score)
    .map(({ a }, place) => ({ ...a, finishing: place }))
}

// Once nothing is being played out, the held action next in the order of
// finishing is taken up to be played out like any other, priced as what is
// left of its price; one that lacks something it needs fails, and the AP of
// the round are not touched.
export function releaseNextHeld(state: SceneState): SceneState {
  if (getOpenAction(state)) return state
  const next = getHeldActions(state)
    .filter((h) => h.finishing !== null)
    .sort((a, b) => (a.finishing ?? 0) - (b.finishing ?? 0))[0]
  if (!next) return state
  if (getFinishBar(state, next) !== null) return releaseNextHeld(withdrawActions(state, [next.id], 'failed'))
  const open: Action = { ...next, step: 'react', cost: null, costTerms: [] }
  return setActions(state, getLiveActions(state).map((a) => (a.id === next.id ? open : a)), [next.id])
}
