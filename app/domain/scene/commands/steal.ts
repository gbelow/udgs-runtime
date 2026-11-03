import type { SceneState, StealAction } from '../types'
import { getStealOutcome } from '../rules/steal'

// combat.tex "Theft": "On grazes and failures, attention is drawn", and a
// hit that takes it is noticed; the one robbed is no longer one the thief
// began the turn undetected by.
export function landTheft(state: SceneState, theft: StealAction): SceneState {
  if (!theft.targetId || !getStealOutcome(theft).noticed) return state
  return {
    ...state,
    stealthTurns: state.stealthTurns.map((t) => (t.turn === state.turn && t.id === theft.actorId ? { ...t, hiddenFrom: t.hiddenFrom.filter((id) => id !== theft.targetId) } : t)),
  }
}
