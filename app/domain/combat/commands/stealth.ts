import type { CombatState } from '../types'
import { isSeenByActiveSense } from '../rules/detection'
import { getStealthValue } from '../rules/stealth'

// combat.tex "Stealth in combat", "Staying in stealth": "The character must
// begin their turn undetectable through any active sense in order to be
// considered in stealth. They must go back to being undetectable to any enemy
// active senses and end their turn to continue in stealth. Failing to do so
// causes automatic detection by everyone (their stealth value disappears)."
// The next round calls a new test of whoever is then undetectable.
export function revealIfSeen(state: CombatState, id: string): CombatState {
  if (getStealthValue(state, id) === null || !isSeenByActiveSense(state, id)) return state
  return { ...state, heldTests: state.heldTests.filter((t) => t.id !== id || t.kind !== 'stealth') }
}
