import type { CampaignEntry, Party } from '../types'
import { ETS_PER_DAY, describeClock, getDay } from '../rules/clock'
import { hasGmTools, type Role } from '../../profiles'
import { KIND_LABELS } from './journal'

// Where a party stands on its timeline: living it, or stopped on it. Only the
// first feels time pass. A party outside time has no lane.
export type LaneStatus = 'running' | 'frozen'

export type EntryRef = { id: string; kind: string; note: boolean; title: string }

// The entries written at one moment of a lane; `at` is how far along the axis
// the moment lies, as a percentage of its width.
export type TimelineMark = { clock: number; at: number; when: string; entries: EntryRef[] }

export type TimelineLane = {
  // null is the campaign as a whole, which has no status and no now
  id: string | null
  name: string
  status: LaneStatus | null
  nowClock: number | null
  now: number | null
  nowLabel: string
  // the stretch of the axis the party has lived or stopped at, as percentages
  lived: { from: number; width: number } | null
  marks: TimelineMark[]
}

export type TimelineChart = {
  lanes: TimelineLane[]
  // the days along the axis
  ticks: { at: number; label: string }[]
  // the parties whose time is passing
  running: string[]
  // every party, and where it is, for placing it on the timeline
  parties: { id: string; name: string; when: string }[]
  etsPerDay: number
}

const MARGIN = 3
const MAX_TICKS = 10

// The timelines of the parties on one, side by side on one axis of ETs, with
// what play recorded and the table wrote laid along them where it happened.
// The GM's notes are left out for anyone without the GM's tools.
export function getTimelineChart({ journal, parties }: { journal: CampaignEntry[], parties: Record<string, Party> }, { role }: { role: Role }): TimelineChart {
  const gm = hasGmTools(role)
  const seen = journal.filter((e) => gm || !e.gmOnly)
  const last = Math.max(1, ...Object.values(parties).map((p) => p.clock ?? 0), ...seen.map((e) => e.clock ?? 0))
  const along = (clock: number) => MARGIN + (100 - 2 * MARGIN) * (clock / last)
  const ref = (e: CampaignEntry): EntryRef => ({ id: e.id, kind: KIND_LABELS[e.kind], note: e.kind === 'note', title: e.title })

  const laneOf = (id: string | null, name: string, status: LaneStatus | null, clock: number | null): TimelineLane => {
    const byClock = Map.groupBy(seen.filter((e) => e.party === id && e.clock !== null), (e) => e.clock as number)
    return {
      id, name, status,
      nowClock: clock,
      now: clock === null ? null : along(clock),
      nowLabel: clock === null ? '' : describeClock(clock),
      lived: clock === null ? null : { from: MARGIN, width: along(clock) - MARGIN },
      marks: [...byClock].sort(([a], [b]) => a - b).map(([c, es]) => ({ clock: c, at: along(c), when: describeClock(c), entries: es.map(ref) })),
    }
  }

  const lanes = Object.entries(parties).filter(([, p]) => p.clock !== null)
    .map(([id, p]) => laneOf(id, p.name, p.active ? 'running' : 'frozen', p.clock))
  const campaign = laneOf(null, 'the campaign', null, null)
  const days = getDay(last) + 1
  const step = Math.ceil(days / MAX_TICKS)
  return {
    lanes: campaign.marks.length > 0 ? [campaign, ...lanes] : lanes,
    ticks: Array.from({ length: Math.ceil(days / step) }, (_, i) => i * step).map((d) => ({ at: along(d * ETS_PER_DAY), label: `d${d + 1}` })),
    running: lanes.filter((l) => l.status === 'running').map((l) => l.name),
    parties: Object.entries(parties).map(([id, p]) => ({ id, name: p.name, when: p.clock === null ? 'outside time' : describeClock(p.clock) })),
    etsPerDay: ETS_PER_DAY,
  }
}
