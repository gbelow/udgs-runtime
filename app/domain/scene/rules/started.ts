import type { SceneState } from '../types'

// Whether the combat (or chase) has started: its first round is under way.
// Before it nobody takes a turn, and nothing costs AP or STA.
export function isCombatStarted(state: SceneState): boolean {
  return state.round > 0
}

// The same for whatever fight a character is read in: none off the fight.
export function isChargedIn(fight: SceneState | null): boolean {
  return fight !== null && isCombatStarted(fight)
}
