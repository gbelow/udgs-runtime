import type { ExplorationState } from '../types'
import type { Known } from '../../campaign/rules/seen'
import { only, prune, type Censor } from '../../prune'

// Exploration as a viewer who controls some characters is shown it
// (multiplayer-plan.md "Hidden information"): the groups, camps and results of
// their own parties, and the plans of the characters in them.

type ExplorationCensor<V> = Censor<V, Known>

const unseen = <V>(value: V, k: Known): V => prune(value, k.hidden)
const ofParties = <V extends { party: string }>(rows: V[], k: Known): V[] => {
  const kept = rows.filter((r) => k.parties.has(r.party))
  return unseen(kept.length === rows.length ? rows : kept, k)
}

// Every field of exploration says how it is hidden, so that one added does
// not compile until it does.
const CENSORS: { [K in keyof ExplorationState]: ExplorationCensor<ExplorationState[K]> } = {
  groups: (groups, k) => unseen(only(groups, (party) => k.parties.has(party)), k),
  camps: (camps, k) => only(camps, (party) => k.parties.has(party)),
  resting: unseen,
  casts: unseen,
  rests: unseen,
  opening: unseen,
  calls: (calls, k) => only(calls, (id) => !k.hidden.has(calls[id].roller)),
  exhaustionRolls: unseen,
  results: ofParties,
  castResults: ofParties,
  stayResults: ofParties,
}

export function getExplorationSeenBy(state: ExplorationState, known: Known): ExplorationState {
  const entries = Object.entries(CENSORS) as [keyof ExplorationState, ExplorationCensor<unknown>][]
  const seen = Object.fromEntries(entries.map(([key, censor]) => [key, censor(state[key], known)])) as ExplorationState
  return entries.every(([key]) => seen[key] === state[key]) ? state : seen
}
