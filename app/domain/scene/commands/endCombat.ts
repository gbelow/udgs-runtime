import type { SceneState, Updater } from '../types'
import type { Caller, Throw } from '../../play/calls'
import { calling } from './calling'
import { leaveFight } from '../../character/commands/leaveFight'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { getHeldActions } from '../rules/hold'
import { getEndCombatBar } from '../rules/fight'
import { finishHeld } from './hold'

// The combat or chase ends and everyone stays in the scene: what the end of a
// fight does to each (`leaveFight`), and the scene goes back to before its
// first round with nothing the rounds held. What was held over finishes, in
// the order of the cunning tests, for nothing. The log stays.
export function endCombat(thrown: Throw): Updater {
  return calling({ kind: 'endCombat' }, thrown, (caller) => (state) => (getEndCombatBar(state) ? state : endScene(state, caller)))
}

// The combat ends, whatever ended it: the table, or a chase that is over.
export function endScene(state: SceneState, caller: Caller): SceneState {
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, leaveFight(expireUsedAbilities(c))]))
  const ended = {
    ...state,
    characters,
    round: 0,
    roundStep: null,
    chase: null,
    inTurnCharacter: '',
    forcedSurge: '',
    fleeing: false,
    turnQueue: [],
    fleers: [],
    contenders: [],
    lastContest: null,
    agreedToEnd: [],
    concentration: [],
    morale: [],
    compulsions: [],
    heldTests: [],
    turnsTaken: [],
    prepared: [],
    following: {},
    stealthTurns: [],
    pressure: [],
  }
  return finishHeld(ended, getHeldActions(ended).map((h) => h.id), caller)
}
