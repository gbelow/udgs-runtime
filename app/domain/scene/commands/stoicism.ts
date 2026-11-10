import type { SceneState } from '../types'
import { getFirstMoverAP } from '../rules/stoicism'
import { isCombatStarted } from '../rules/started'
import { updateCharacter } from './characters'

// abilities.json "First Mover": the round's first turn passes from `from`
// (nobody, as it is first taken) to `to`, and the AP it gives go with it:
// taken back from whoever a cunning contest won it from, before their turn
// was under way, and given to whoever takes it.
export function passFirstMoverAP(state: SceneState, from: string | null, to: string): SceneState {
  if (!isCombatStarted(state) || from === to) return state
  const taken = from ? shiftAP(state, from, -getFirstMoverAP(state.characters[from])) : state
  return shiftAP(taken, to, getFirstMoverAP(taken.characters[to]))
}

function shiftAP(state: SceneState, id: string, AP: number): SceneState {
  return AP === 0 ? state : updateCharacter(id, (c) => ({ ...c, resources: { ...c.resources, AP: c.resources.AP + AP } }), 'First Mover')(state)
}
