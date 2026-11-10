import type { Action, Degree, SceneState } from '../types'
import type { ModeOf } from '../../play/calls'
import { getTestMode } from '../../character/rules/effects'

// Whether the action's test came to a hit or a critical.
export function isWon(root: Pick<Action, 'roll'>): boolean {
  return root.roll?.degree === 'hit' || root.roll?.degree === 'critical'
}

// combat.tex "Evasion": a reflex test against what is coming turns the
// target's degree against it — "On a graze ... only takes half damage", on
// a miss the whole of it, on a hit or better none.
export function resisted(degree: Degree): Degree {
  switch (degree) {
    case 'miss': return 'hit'
    case 'graze': return 'graze'
    default: return 'miss'
  }
}

// play.tex "Safe and risky tests": the way each one in the scene throws a die
// for a test, as they stand.
export function getSceneModeOf(state: SceneState): ModeOf {
  return (roller, picked) => getTestMode(state.characters[roller], picked)
}
