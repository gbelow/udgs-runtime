import type { CombatState, RootAction } from '../combat/types'
import type { Dice } from '../combat/dice'
import { getOpenAction } from '../combat/rules/log'
import { hasAgreedToEnd } from '../combat/rules/turn'
import { cancelAction, rollOrPay, withdrawSpawnedAction } from '../combat/commands/action'
import { toggleAgreeToEnd } from '../combat/commands/turn'
import { findParty, type Party } from './party'

// What a bot finds still declared and not committed that it will not take:
// a follow-up an action opened for it is passed up, anything else abandoned.
export function passUp(state: CombatState, open: RootAction, newId: () => string): CombatState {
  return open.spawnedBy ? withdrawSpawnedAction(newId)(state) : cancelAction()(state)
}

// What the table does when no bot has a move, for the characters no bot
// plays: they answer nothing, so it throws the die of an action waiting on
// them, passes up what they were left to declare, and has them say they are
// done for the round. Null when there is nothing to do.
export function tableMove(state: CombatState, parties: readonly Party[], dice: Dice, newId: () => string): CombatState | null {
  const open = getOpenAction(state)
  const next = open ? moveOpen(state, open, dice, newId) : agree(state, parties)
  return next !== state ? next : null
}

function moveOpen(state: CombatState, open: RootAction, dice: Dice, newId: () => string): CombatState {
  if (open.step === 'react') return rollOrPay(dice, newId)(state)
  return open.step === 'define' ? passUp(state, open, newId) : state
}

function agree(state: CombatState, parties: readonly Party[]): CombatState {
  const idle = Object.keys(state.characters).find((id) => !findParty(parties, id) && !hasAgreedToEnd(state, id))
  return idle ? toggleAgreeToEnd(idle)(state) : state
}
