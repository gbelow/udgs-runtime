import type { CampaignEntry, EntryKind } from '../types'
import { describeClock } from '../rules/clock'
import { canChangeEntry, hasGmTools, type Role } from '../../profiles'

export const KIND_LABELS: Record<EntryKind, string> = { note: 'note', et: 'ET', days: 'downtime', scene: 'scene', fight: 'fight log', sync: 'sync' }

// `editable`: a note the viewer may rewrite; `removable`: one they may
// throw away.
export type EntryView = { id: string; party: string | null; clock: number | null; kind: string; note: boolean; when: string; title: string; lines: string[]; gmOnly: boolean; editable: boolean; removable: boolean }

// One party's part of the journal, newest first; `id` is null for what is
// the campaign's as a whole.
export type JournalPartyView = { id: string | null; name: string; entries: EntryView[] }

// Which part of the journal is read: everything, one party's, or the
// campaign's own (null); by whom, as what in the campaign, which decides
// whether the GM's notes are shown and what may be changed; and at most how
// many of each party's newest entries.
export type JournalFilter = { party: string | null | 'all'; profile: string | null; role: Role; limit?: number }

// The journal by party, each party under the name it has now or had when
// last written of, the campaign's own entries first.
export function getJournalView({ journal, parties }: { journal: CampaignEntry[], parties: Record<string, { name: string }> }, { party, profile, role, limit }: JournalFilter): JournalPartyView[] {
  const gm = hasGmTools(role)
  const shown = journal.map((e, at) => ({ e, at })).filter(({ e }) => (gm || !e.gmOnly) && (party === 'all' || e.party === party))
  const groups = Map.groupBy(shown, ({ e }) => e.party)
  // newest first: the latest moment, and of one moment the last written
  const newestFirst = (a: { e: CampaignEntry, at: number }, b: { e: CampaignEntry, at: number }) => (b.e.clock ?? -1) - (a.e.clock ?? -1) || b.at - a.at
  return [...groups].sort(([a], [b]) => Number(a !== null) - Number(b !== null)).map(([id, entries]) => ({
    id,
    name: id ? parties[id]?.name ?? entries.at(-1)?.e.partyName ?? id : 'the campaign',
    entries: [...entries].sort(newestFirst).slice(0, limit).map(({ e }) => ({
      id: e.id, party: e.party, clock: e.clock, kind: KIND_LABELS[e.kind], note: e.kind === 'note', when: e.clock === null ? (e.party ? 'outside time' : '') : describeClock(e.clock),
      title: e.title, lines: e.lines, gmOnly: e.gmOnly,
      editable: e.kind === 'note' && canChangeEntry(e.author, profile, role),
      removable: canChangeEntry(e.author, profile, role),
    })),
  }))
}
