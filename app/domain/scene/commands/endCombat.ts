import type { Updater } from '../types'
import type { Dice } from '../../play/dice'
import { leaveFight } from '../../character/commands/leaveFight'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { getHeldActions } from '../rules/hold'
import { getEndCombatBar } from '../rules/fight'
import { finishHeld } from './hold'

// The combat or chase ends and everyone stays in the scene: what the end of a
// fight does to each (`leaveFight`), and the scene goes back to before its
// first round with nothing the rounds held. What was held over finishes, in
// the order of the cunning tests, for nothing. The log stays.
export function endCombat(dice: Dice): Updater {
  return (state) => {
    if (getEndCombatBar(state)) return state
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
      stealthTurns: [],
      pressure: [],
    }
    return finishHeld(ended, getHeldActions(ended).map((h) => h.id), dice)
  }
}
