import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { hasAgreedToEnd } from '../scene/rules/turn'
import { cancelAction, resolveAction, rollOrPay, withdrawSpawnedAction } from '../scene/commands/action'
import { toggleAgreeToEnd } from '../scene/commands/turn'
import { findParty, type Party } from './party'

// What a bot finds still declared and not committed that it will not take:
// a follow-up an action opened for it is passed up, anything else abandoned.
export function passUp(state: SceneState, open: RootAction, newId: () => string): SceneState {
  return open.spawnedBy ? withdrawSpawnedAction(newId)(state) : cancelAction()(state)
}

// What the table does when no bot has a move, for the characters no bot
// plays: they answer nothing, so it throws the die of an action waiting on
// them, lands what is rolled, passes up what they were left to declare, and
// has them say they are done for the round. Null when there is nothing to do.
export function tableMove(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): SceneState | null {
  const open = getOpenAction(state)
  const next = open ? moveOpen(state, open, dice, newId) : agree(state, parties)
  return next !== state ? next : null
}

function moveOpen(state: SceneState, open: RootAction, dice: Dice, newId: () => string): SceneState {
  if (open.step === 'react') return rollOrPay(dice, newId)(state)
  if (open.step === 'post') return resolveAction(newId)(state)
  return open.step === 'define' ? passUp(state, open, newId) : state
}

function agree(state: SceneState, parties: readonly Party[]): SceneState {
  const idle = Object.keys(state.characters).find((id) => !findParty(parties, id) && !hasAgreedToEnd(state, id))
  return idle ? toggleAgreeToEnd(idle)(state) : state
}
