import type { Compulsion, SceneState, SpellTestAction, Updater } from '../types'
import { actionSurge } from '../../character/commands/actionSurge'
import { inflict } from '../../character/commands/addAffliction'
import { getOpenAction } from '../rules/log'
import { getNextStress, getStressTurns, isStressAutomatic } from '../rules/stress'
import { getTurnHolder } from '../rules/turn'
import { updateCharacter } from './characters'
import { beginTurn } from './sequence'

// creating.tex "Limit Stress Actions": once every test of the round is made,
// the actions they activated are owed, the worst test first, and the first of
// them takes its turn before anyone else's. Tanatosis is no turn: "Falls to
// the ground unconscious". Nor is a martyr's, when they can pay for it: their
// reaction surge is made at once.
export function oweStress(state: SceneState): SceneState {
  const stress = getStressTurns(state)
  const kept = state.compulsions.filter((t) => t.by !== '')
  return takeStressTurn(makeAutomatic({ ...state, compulsions: [...kept, ...stress] }, stress.filter((t) => t.taken)))
}

function makeAutomatic(state: SceneState, done: Compulsion[]): SceneState {
  return done.reduce((s, { id, action }) => {
    if (action === 'tanatosis') return updateCharacter(id, inflict(['unconscious']), 'limit stress')(s)
    return action === 'martyr' ? updateCharacter(id, actionSurge('reaction'), 'limit stress')(s) : s
  }, state)
}

// combat.tex "Morale": what a morale spell's test did to the limit stress
// actions — a miss activates one at once, in place of any the target still
// owes, bound as the spell binds it (spells.tex "Overwhelming Terror",
// "Provocative Mockery"); Pacify takes back one still owed. The turn it is
// taken in begins once nothing is being played out (sequence.ts).
export function compelByTest(state: SceneState, test: SpellTestAction): SceneState {
  const outcome = test.morale
  const id = test.targetId
  if (!outcome || !id || !state.characters[id]) return state
  const others = state.compulsions.filter((t) => t.id !== id || t.taken)
  if (outcome.pacified) return { ...state, compulsions: others }
  if (!outcome.compel) return state
  const owed: Compulsion = { id, action: outcome.compel, acted: false, taken: isStressAutomatic(state, id, outcome.compel), by: test.actorId, constraint: outcome.constraint }
  return makeAutomatic({ ...state, compulsions: [...others, owed] }, owed.taken ? [owed] : [])
}

// The next owed turn begins, once nothing else holds or waits for the turn.
export function takeStressTurn(state: SceneState): SceneState {
  const next = getNextStress(state)
  if (!next || getTurnHolder(state) || getOpenAction(state) || state.turnQueue.length > 0) return state
  return beginTurn(state, next.id)
}

// What became of the character's owed limit stress action: their turn is over,
// they took the social action it compels, or they defaulted to another.
export function markStress(id: string, mark: Partial<Pick<Compulsion, 'action' | 'acted' | 'taken'>>): Updater {
  return (state) => ({ ...state, compulsions: state.compulsions.map((t) => (t.id === id && !t.taken ? { ...t, ...mark } : t)) })
}
