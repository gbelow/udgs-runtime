import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { hasAgreedToEnd } from '../scene/rules/turn'
import { nextRound } from '../scene/commands/nextRound'
import { getHeldActions } from '../scene/rules/hold'
import { getOwnCost } from '../scene/rules/action'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getRoundPhase } from '../scene/rules/roundChange'
import { findParty, type Party } from './party'
import { ifChanged, play, type Played } from './move'
import type { SceneCommand } from '../scene/commands/registry'

// What a bot finds still declared and not committed that it will not take:
// a follow-up an action opened for it is passed up, anything else abandoned.
export function passUp(state: SceneState, open: RootAction, dice: Dice, newId: () => string): Played {
  return play(state, [{ kind: open.spawnedBy ? 'skip' : 'cancel', args: [] }], dice, newId)
}

// What the table does when no bot has a move, for the characters no bot
// plays: they answer nothing, so it throws the die of an action waiting on
// them, lands what is rolled, passes up what they were left to declare, and
// has them say they are done for the round. At the round change everyone
// holds on to what they can, tests their morale normally, and the change moves
// on. Null when there is nothing to do.
export function tableMove(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): Played | null {
  const open = getOpenAction(state)
  if (open) return ifChanged(state, moveOpen(state, open, dice, newId))
  if (getRoundPhase(state)) return stepRoundChange(state, dice, () => true)
  return agree(state, parties, dice, newId)
}

// One move of the round change by whoever `plays` the characters: a
// concentrating character finishes the action they held when its AP are
// there, else holds on to what they can, else lets go; a character called to
// a test tests their morale normally, unless `tests` is off. Once nobody in
// the fight is played by anyone else, the change moves on. Null when there is
// nothing to do.
export function stepRoundChange(state: SceneState, dice: Dice, plays: (id: string) => boolean, tests = true): Played | null {
  if (!getRoundPhase(state)) return null
  const next = chooseConcentration(state, plays) ?? (tests ? testMorale(state, plays) : null) ?? (Object.keys(state.characters).every(plays) && !getContinueBar(state) ? { kind: 'continueRound', args: [] } as const : null)
  return next ? ifChanged(state, play(state, [next], dice, noIds)) : null
}

// the round change's commands make no ids of their own
const noIds = () => ''

function chooseConcentration(state: SceneState, plays: (id: string) => boolean): SceneCommand | null {
  const owed = getConcentrationOwed(state).find(plays)
  if (!owed) return null
  const c = state.characters[owed]
  const finishes = getHeldActions(state).some((h) => h.actorId === owed && (getOwnCost(state, h)?.AP ?? Infinity) <= c.resources.AP)
  return { kind: finishes || getHoldOnBar(state, owed) ? 'letGo' : 'holdOn', args: [owed] }
}

function testMorale(state: SceneState, plays: (id: string) => boolean): SceneCommand | null {
  const untested = state.morale.find((m) => m.roll === null && state.characters[m.id] && plays(m.id))
  return untested ? { kind: 'rollMorale', args: [untested.id, 'normal', true] } : null
}

// The round passes and its change is moved on as far as it goes with nobody
// testing morale or taking a turn.
export function passRound(dice: Dice): (state: SceneState) => SceneState {
  return (state) => {
    let current = nextRound(dice)(state)
    for (let next = stepRoundChange(current, dice, () => true, false); next; next = stepRoundChange(current, dice, () => true, false)) current = next.state
    return current
  }
}

function moveOpen(state: SceneState, open: RootAction, dice: Dice, newId: () => string): Played {
  if (open.step === 'react') return play(state, [{ kind: 'rollOrPay', args: [] }], dice, newId)
  if (open.step === 'post') return play(state, [{ kind: 'resolve', args: [] }], dice, newId)
  return open.step === 'define' ? passUp(state, open, dice, newId) : { move: [], state }
}

function agree(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): Played | null {
  const idle = Object.keys(state.characters).find((id) => !findParty(parties, id) && !hasAgreedToEnd(state, id))
  return idle ? ifChanged(state, play(state, [{ kind: 'toggleAgreeToEnd', args: [idle] }], dice, newId)) : null
}
