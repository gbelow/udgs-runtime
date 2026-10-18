import type { CampaignState } from '../types'
import { isEntryKnown, type Known } from '../rules/seen'
import { keep, only, prune, type Censor } from '../../prune'

// The campaign as a viewer who controls some of its characters is shown it
// (multiplayer-plan.md "Hidden information"): their own parties and the
// characters in them, and a journal of what was written to those parties.

type CampaignCensor<V> = Censor<V, Known>

const unseen = <V>(value: V, k: Known): V => prune(value, k.hidden)

// Every field of the campaign says how it is hidden, so that one added does
// not compile until it does.
const CENSORS: { [K in keyof CampaignState]: CampaignCensor<CampaignState[K]> } = {
  characters: unseen,
  dayETs: keep,
  breakage: keep,
  maps: keep,
  journal: (entries, k) => unseen(entries.filter((e) => isEntryKnown(e, k)), k),
  parties: (parties, k) => only(parties, (id) => k.parties.has(id)),
  partyOf: (partyOf, k) => only(partyOf, (id) => !k.hidden.has(id)),
  names: unseen,
  out: unseen,
  lent: unseen,
}

// The campaign as the viewer sees it, given what they are told of it
// (`getKnownBy`); the GM, who is told of everything, is shown the state itself.
export function getCampaignSeenBy(state: CampaignState, known: Known): CampaignState {
  const entries = Object.entries(CENSORS) as [keyof CampaignState, CampaignCensor<unknown>][]
  const seen = Object.fromEntries(entries.map(([key, censor]) => [key, censor(state[key], known)])) as CampaignState
  return entries.every(([key]) => seen[key] === state[key]) ? state : seen
}
