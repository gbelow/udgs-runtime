import type { Updater } from '../types'
import { getBreakageBar } from '../rules/breakage'

// gear.tex "Equipment Breakage": the optional rule switched on or off for the
// fight, between actions.
export const toggleBreakage: Updater = (state) => {
  if (getBreakageBar(state)) return state
  return { ...state, breakage: !state.breakage }
}
