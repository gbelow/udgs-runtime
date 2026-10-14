import type { CampaignState, Party } from '../types'
import { ETS_PER_DAY, describeClock, getDaysEnded, getPlayingParties, isNight } from '../rules/clock'
import { perState } from '../../perState'
import { getClockView, type ClockView } from './clock'

// A way to bring a party to another timeline's time, always forward: placed
// there without living the time between, or living it. `warning` says what
// that does to the party before the table commits to it.
export type SyncOption = { to: number; how: 'place' | 'pass'; label: string; warning: string }

export type TimelineView = {
  partyId: string
  name: string
  active: boolean
  // where the party is on its timeline, or null outside time
  clock: ClockView | null
  night: boolean
  options: SyncOption[]
}

// A moment in play: the time on it and the parties living it.
export type MomentView = { clock: ClockView; night: boolean; parties: string[] }

function span(ETs: number): string {
  const days = Math.floor(ETs / ETS_PER_DAY)
  const rest = ETs % ETS_PER_DAY
  return [days ? `${days} day${days === 1 ? '' : 's'}` : '', rest ? `${rest} ET${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ')
}

// The names of these parties by the clock each is at, earliest first.
function byClock(parties: Party[]): [number, string[]][] {
  const grouped = new Map<number, string[]>()
  for (const p of parties) if (p.clock !== null) grouped.set(p.clock, [...(grouped.get(p.clock) ?? []), p.name])
  return [...grouped.entries()].sort(([a], [b]) => a - b)
}

// The party's place in time, and the ways to bring it to the time of every
// other timeline ahead of it; a party outside time may also start a
// timeline of its own.
export function getTimelineView(state: CampaignState, partyId: string, party: Party): TimelineView {
  const from = party.clock
  const ahead = Object.entries(state.parties).filter(([pid, p]) => pid !== partyId && p.clock !== null && (from === null || p.clock > from)).map(([, p]) => p)
  const options: SyncOption[] = []
  if (from === null) {
    options.push({ to: 0, how: 'place', label: 'start a timeline', warning: `${party.name} starts a timeline of its own at ${describeClock(0)}` })
  }
  for (const [to, names] of byClock(ahead)) {
    const who = names.join(', ')
    if (from === null) {
      options.push({ to, how: 'place', label: `join ${who}`, warning: `${party.name} enters ${who}'s timeline at ${describeClock(to)} and feels time from then on` })
      continue
    }
    const gap = span(to - from)
    const days = getDaysEnded(from, to)
    options.push({ to, how: 'place', label: `place at ${who}`, warning: `${party.name} skips ${gap} to ${describeClock(to)} without living it: no hunger, thirst, healing or wear` })
    options.push({ to, how: 'pass', label: `live until ${who}`, warning: `${party.name} lives ${gap} to ${describeClock(to)}: ${days} day${days === 1 ? ' ends' : 's end'}, each adding hunger and thirst, and what was taken wears off` })
  }
  return {
    partyId,
    name: party.name,
    active: party.active,
    clock: from === null ? null : getClockView(from),
    night: isNight(from, state.dayETs),
    options,
  }
}

// The moments the parties in play are living, earliest first.
export const getMoments = perState((state: CampaignState): MomentView[] =>
  byClock(getPlayingParties(state).map((pid) => state.parties[pid]))
    .map(([clock, parties]) => ({ clock: getClockView(clock), night: isNight(clock, state.dayETs), parties })))

export const getMomentsDigest = perState((state: CampaignState) => JSON.stringify(getMoments(state)))
