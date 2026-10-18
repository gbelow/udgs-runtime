import type { DowntimeState } from '../types'
import type { Known } from '../../campaign/rules/seen'
import { keep, only, prune, type Censor } from '../../prune'

// Downtime as a viewer who controls some characters is shown it
// (multiplayer-plan.md "Hidden information"): the plans and results of the
// characters in their own parties.

type DowntimeCensor<V> = Censor<V, Known>

// Every field of downtime says how it is hidden, so that one added does not
// compile until it does.
const CENSORS: { [K in keyof DowntimeState]: DowntimeCensor<DowntimeState[K]> } = {
  plans: (plans, k) => prune(plans, k.hidden),
  // a result names its character, not their id
  results: (results, k) => {
    const kept = results.filter((r) => !k.hiddenNames.has(r.name))
    return kept.length === results.length ? results : kept
  },
  calls: (calls, k) => only(calls, (id) => !k.hidden.has(calls[id].roller)),
  passing: keep,
}

export function getDowntimeSeenBy(state: DowntimeState, known: Known): DowntimeState {
  const entries = Object.entries(CENSORS) as [keyof DowntimeState, DowntimeCensor<unknown>][]
  const seen = Object.fromEntries(entries.map(([key, censor]) => [key, censor(state[key], known)])) as DowntimeState
  return entries.every(([key]) => seen[key] === state[key]) ? state : seen
}
