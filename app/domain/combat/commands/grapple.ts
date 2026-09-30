import type { Updater } from '../types'
import { getHeldGrapples } from '../rules/grapple'

// A holder left with no grapple row lets go ("the grapplers must have a
// grapple property attack in one of their weapons at all times"), after
// anything that may have taken it from them. What the grapples put on their
// members is read off them (`getGrappleAfflictionsOf`), so nothing else
// follows.
export const settleGrapples: Updater = (state) => {
  const after = getHeldGrapples(state)
  return after === state.grapples ? state : { ...state, grapples: after }
}
