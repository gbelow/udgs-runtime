import type { CombatState } from '../types'

// A projection computed once per state object. Every store write replaces the
// state rather than changing it, so a state already seen is one whose view is
// already known: the digest a hook gates on and the view it then renders read
// the same computation.
export function perState<T>(project: (state: CombatState) => T): (state: CombatState) => T {
  const views = new WeakMap<CombatState, T>()
  return (state) => {
    if (views.has(state)) return views.get(state) as T
    const view = project(state)
    views.set(state, view)
    return view
  }
}
