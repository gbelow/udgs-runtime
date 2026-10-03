import type { CombatState, StressTurn, Updater } from '../types'
import { actionSurge } from '../../character/commands/actionSurge'
import { inflict } from '../../character/commands/addAffliction'
import { getOpenAction } from '../rules/log'
import { getNextStress, getStressTurns } from '../rules/stress'
import { getTurnHolder } from '../rules/turn'
import { updateCharacter } from './characters'
import { beginTurn } from './sequence'

// creating.tex "Limit Stress Actions": once every test of the round is made,
// the actions they activated are owed, the worst test first, and the first of
// them takes its turn before anyone else's. Tanatosis is no turn: "Falls to
// the ground unconscious". Nor is a martyr's, when they can pay for it: their
// reaction surge is made at once.
export function oweStress(state: CombatState): CombatState {
  const stress = getStressTurns(state)
  const done = stress.filter((t) => t.taken)
  const owed = done.reduce((s, { id, action }) => {
    if (action === 'tanatosis') return updateCharacter(id, inflict(['unconscious']))(s)
    return action === 'martyr' ? updateCharacter(id, actionSurge('reaction'))(s) : s
  }, { ...state, stress })
  return takeStressTurn(owed)
}

// The next owed turn begins, once nothing else holds or waits for the turn.
export function takeStressTurn(state: CombatState): CombatState {
  const next = getNextStress(state)
  if (!next || getTurnHolder(state) || getOpenAction(state) || state.turnQueue.length > 0) return state
  return beginTurn(state, next.id)
}

// What became of the character's owed limit stress action: their turn is over,
// they took the social action it compels, or they defaulted to another.
export function markStress(id: string, mark: Partial<Pick<StressTurn, 'action' | 'acted' | 'taken'>>): Updater {
  return (state) => ({ ...state, stress: state.stress.map((t) => (t.id === id && !t.taken ? { ...t, ...mark } : t)) })
}
