import type { CampaignState, CampaignUpdater, EntryKind } from '../types'

export type EntryDraft = {
  kind: EntryKind
  party: string | null
  title: string
  lines?: string[]
  gmOnly?: boolean
  author?: string | null
  // the moment it happened, where that is not the party's clock now
  clock?: number | null
}

// The id the next entry is written under: one past the highest so far.
function nextEntryId(state: CampaignState): string {
  return String(state.journal.reduce((top, e) => Math.max(top, Number(e.id) || 0), 0) + 1)
}

// Writes an entry to the journal, at the party's moment and under its name.
export function record({ kind, party, title, lines = [], gmOnly = false, author = null, clock }: EntryDraft): CampaignUpdater {
  return (state) => {
    const at = party ? state.parties[party] : undefined
    const entry = {
      id: nextEntryId(state), kind, party, partyName: at?.name ?? '',
      clock: clock !== undefined ? clock : at?.clock ?? null, title, lines, gmOnly, author,
    }
    return { ...state, journal: [...state.journal, entry] }
  }
}

// The GM's or a player's own note, to a party at its moment or to the
// campaign as a whole, under the profile that wrote it; one kept from the
// players is marked `gmOnly`.
export function writeNote(party: string | null, text: string, gmOnly: boolean, author: string | null): CampaignUpdater {
  return (state) => (text.trim() === '' || (party !== null && !state.parties[party]) ? state
    : record({ kind: 'note', party, title: '', lines: text.trim().split('\n'), gmOnly, author })(state))
}

// A note rewritten where it stands, kept from the players or not; what play
// recorded is not a note and stays as it was.
export function editNote(id: string, text: string, gmOnly: boolean): CampaignUpdater {
  return (state) => (text.trim() === '' || !state.journal.some((e) => e.id === id && e.kind === 'note') ? state
    : { ...state, journal: state.journal.map((e) => (e.id === id ? { ...e, lines: text.trim().split('\n'), gmOnly } : e)) })
}

export function removeEntry(id: string): CampaignUpdater {
  return (state) => (state.journal.some((e) => e.id === id) ? { ...state, journal: state.journal.filter((e) => e.id !== id) } : state)
}
