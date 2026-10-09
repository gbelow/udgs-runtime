import type { Updater } from '../types'
import { getHeldBinds } from '../rules/bind'

// A holder who no longer maintains their bind lets go, after anything that
// may have taken what holds it from them. What a bind puts on its members
// is read off it, so nothing else follows.
export const settleBinds: Updater = (state) => {
  const after = getHeldBinds(state)
  return after === state.binds ? state : { ...state, binds: after }
}
