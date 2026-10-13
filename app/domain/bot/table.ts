import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { hasAgreedToEnd } from '../scene/rules/turn'
import { cancelAction, resolveAction, rollOrPay, withdrawSpawnedAction } from '../scene/commands/action'
import { toggleAgreeToEnd } from '../scene/commands/turn'
import { continueRound, holdOn, letGo, nextRound } from '../scene/commands/nextRound'
import { getHeldActions } from '../scene/rules/hold'
import { getOwnCost } from '../scene/rules/action'
import { rollMorale } from '../scene/commands/morale'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getRoundPhase } from '../scene/rules/roundChange'
import { findParty, type Party } from './party'

// What a bot finds still declared and not committed that it will not take:
// a follow-up an action opened for it is passed up, anything else abandoned.
export function passUp(state: SceneState, open: RootAction, newId: () => string): SceneState {
  return open.spawnedBy ? withdrawSpawnedAction(newId)(state) : cancelAction()(state)
}

// What the table does when no bot has a move, for the characters no bot
// plays: they answer nothing, so it throws the die of an action waiting on
// them, lands what is rolled, passes up what they were left to declare, and
// has them say they are done for the round. At the round change everyone
// holds on to what they can, tests their morale normally, and the change moves
// on. Null when there is nothing to do.
export function tableMove(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): SceneState | null {
  const open = getOpenAction(state)
  const next = open ? moveOpen(state, open, dice, newId) : getRoundPhase(state) ? stepRoundChange(state, dice, () => true) ?? state : agree(state, parties)
  return next !== state ? next : null
}

// One move of the round change by whoever `plays` the characters: a
// concentrating character finishes the action they held when its AP are
// there, else holds on to what they can, else lets go; a character called to
// a test tests their morale normally, unless `tests` is off. Once nobody in
// the fight is played by anyone else, the change moves on. Null when there is
// nothing to do.
export function stepRoundChange(state: SceneState, dice: Dice, plays: (id: string) => boolean, tests = true): SceneState | null {
  if (!getRoundPhase(state)) return null
  const next = chooseConcentration(state, dice, plays) ?? (tests ? testMorale(state, dice, plays) : null) ?? (Object.keys(state.characters).every(plays) && !getContinueBar(state) ? continueRound(dice)(state) : null)
  return next !== null && next !== state ? next : null
}

function chooseConcentration(state: SceneState, dice: Dice, plays: (id: string) => boolean): SceneState | null {
  const owed = getConcentrationOwed(state).find(plays)
  if (!owed) return null
  const c = state.characters[owed]
  const finishes = getHeldActions(state).some((h) => h.actorId === owed && (getOwnCost(state, h)?.AP ?? Infinity) <= c.resources.AP)
  return finishes || getHoldOnBar(state, owed) ? letGo(owed, dice)(state) : holdOn(owed, dice)(state)
}

function testMorale(state: SceneState, dice: Dice, plays: (id: string) => boolean): SceneState | null {
  const untested = state.morale.find((m) => m.roll === null && state.characters[m.id] && plays(m.id))
  return untested ? rollMorale(untested.id, 'normal', true, dice)(state) : null
}

// The round passes and its change is moved on as far as it goes with nobody
// testing morale or taking a turn.
export function passRound(dice: Dice): (state: SceneState) => SceneState {
  return (state) => {
    let current = nextRound(dice)(state)
    for (let next = stepRoundChange(current, dice, () => true, false); next; next = stepRoundChange(current, dice, () => true, false)) current = next
    return current
  }
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
