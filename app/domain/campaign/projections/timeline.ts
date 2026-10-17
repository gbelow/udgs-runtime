import type { CampaignState, Party } from '../types'
import { describeClock, describeSpan, getDaysEnded, getPlayingParties, isNight } from '../rules/clock'
import { perState } from '../../perState'
import { getClockView, type ClockView } from './clock'

// A way to bring a party to a moment, always forward: placed there without
// living the time between, or living it. `warning` says what that does to the
// party before the table commits to it.
export type PlacementOption = { how: 'place' | 'pass'; label: string; warning: string }

// What bringing a party to the moment `to` offers, or `bar` why it cannot be.
export type Placement = { to: number; bar: string | null; options: PlacementOption[] }

export type TimelineView = {
  partyId: string
  name: string
  active: boolean
  // where the party is on its timeline, or null outside time
  clock: ClockView | null
  night: boolean
}

// A moment in play: the time on it and the parties living it.
export type MomentView = { clock: ClockView; night: boolean; parties: string[] }

// The names of these parties by the clock each is at, earliest first.
function byClock(parties: Party[]): [number, string[]][] {
  const grouped = new Map<number, string[]>()
  for (const p of parties) if (p.clock !== null) grouped.set(p.clock, [...(grouped.get(p.clock) ?? []), p.name])
  return [...grouped.entries()].sort(([a], [b]) => a - b)
}

// The party's place in time.
export function getTimelineView(state: CampaignState, partyId: string, party: Party): TimelineView {
  return {
    partyId,
    name: party.name,
    active: party.active,
    clock: party.clock === null ? null : getClockView(party.clock),
    night: isNight(party.clock, state.dayETs),
  }
}

// The ways to bring the party to the moment `to`: a party outside time is
// placed on the timeline there; one on it is placed forward, or lives the
// time between. Time is never turned back.
export function getPlacement(parties: Record<string, Party>, partyId: string, to: number): Placement {
  const party = parties[partyId]
  if (!party) return { to, bar: 'no such party', options: [] }
  const from = party.clock
  if (from === null) {
    return { to, bar: null, options: [{ how: 'place', label: 'place', warning: `${party.name} joins the timeline at ${describeClock(to)}` }] }
  }
  if (to <= from) return { to, bar: `${party.name} is already at ${describeClock(from)}: time is never turned back`, options: [] }
  const gap = describeSpan(to - from)
  const days = getDaysEnded(from, to)
  return {
    to,
    bar: null,
    options: [
      { how: 'place', label: 'place', warning: `${party.name} skips ${gap} to ${describeClock(to)} without living it: no hunger, thirst, healing or wear` },
      { how: 'pass', label: 'live it', warning: `${party.name} lives ${gap} to ${describeClock(to)}: ${days} day${days === 1 ? ' ends' : 's end'}, each adding hunger and thirst, and what was taken wears off` },
    ],
  }
}

// The moments the parties in play are living, earliest first.
export const getMoments = perState((state: CampaignState): MomentView[] =>
  byClock(getPlayingParties(state).map((pid) => state.parties[pid]))
    .map(([clock, parties]) => ({ clock: getClockView(clock), night: isNight(clock, state.dayETs), parties })))

export const getMomentsDigest = perState((state: CampaignState) => JSON.stringify(getMoments(state)))
