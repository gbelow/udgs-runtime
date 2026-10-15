import type { CampaignEntry, EntryKind } from '../types'
import { describeClock } from '../rules/clock'

const KIND_LABELS: Record<EntryKind, string> = { note: 'note', et: 'ET', days: 'downtime', scene: 'scene', fight: 'fight log', sync: 'sync' }

export type EntryView = { id: string; kind: string; note: boolean; when: string; title: string; lines: string[]; gmOnly: boolean }

// One party's part of the journal, newest first; `id` is null for what is
// the campaign's as a whole.
export type JournalPartyView = { id: string | null; name: string; entries: EntryView[] }

// Which part of the journal is read: everything, one party's, or the
// campaign's own (null), with the GM's notes or without.
export type JournalFilter = { party: string | null | 'all'; gm: boolean }

// The journal by party, each party under the name it has now or had when
// last written of, the campaign's own entries first.
export function getJournalView({ journal, parties }: { journal: CampaignEntry[], parties: Record<string, { name: string }> }, { party, gm }: JournalFilter): JournalPartyView[] {
  const shown = journal.map((e, at) => ({ e, at })).filter(({ e }) => (gm || !e.gmOnly) && (party === 'all' || e.party === party))
  const groups = Map.groupBy(shown, ({ e }) => e.party)
  // newest first: the latest moment, and of one moment the last written
  const newestFirst = (a: { e: CampaignEntry, at: number }, b: { e: CampaignEntry, at: number }) => (b.e.clock ?? -1) - (a.e.clock ?? -1) || b.at - a.at
  return [...groups].sort(([a], [b]) => Number(a !== null) - Number(b !== null)).map(([id, entries]) => ({
    id,
    name: id ? parties[id]?.name ?? entries.at(-1)?.e.partyName ?? id : 'the campaign',
    entries: [...entries].sort(newestFirst).map(({ e }) => ({
      id: e.id, kind: KIND_LABELS[e.kind], note: e.kind === 'note', when: e.clock === null ? (e.party ? 'outside time' : '') : describeClock(e.clock),
      title: e.title, lines: e.lines, gmOnly: e.gmOnly,
    })),
  }))
}
