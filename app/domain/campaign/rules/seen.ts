import type { CampaignState } from '../types'

// What a viewer who controls some characters is told of the campaign
// (multiplayer-plan.md "Hidden information"): their own parties, and so the
// characters in them. Nobody else is known to them, by id or by name.
export type Known = {
  controlled: ReadonlySet<string>
  parties: ReadonlySet<string>
  hidden: ReadonlySet<string>
  hiddenNames: ReadonlySet<string>
}

export function getKnownBy(state: CampaignState, controlled: ReadonlySet<string>): Known {
  const parties = new Set<string>()
  for (const id of controlled) if (state.partyOf[id]) parties.add(state.partyOf[id])
  const everyone = new Set([...Object.keys(state.characters), ...Object.keys(state.partyOf), ...Object.keys(state.names), ...state.lent, ...state.out])
  const hidden = new Set([...everyone].filter((id) => !controlled.has(id) && !parties.has(state.partyOf[id])))
  const hiddenNames = new Set([...hidden].flatMap((id) => [state.characters[id]?.name, state.names[id]].filter((n): n is string => !!n)))
  return { controlled, parties, hidden, hiddenNames }
}

// Whether a viewer is shown an entry of the journal: what was written to
// their parties or the campaign as a whole, and not a note kept from the
// players or the log of a fight, which names whoever took part in it.
export function isEntryKnown(entry: CampaignState['journal'][number], known: Known): boolean {
  return !entry.gmOnly && entry.kind !== 'fight' && (entry.party === null || known.parties.has(entry.party))
}
