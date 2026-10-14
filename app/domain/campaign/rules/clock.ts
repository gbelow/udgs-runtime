import type { CampaignState } from '../types'
import { getAway } from './place'

// The campaign clock counts whole ETs. survival.tex "Exploration Turn (ET)":
// "It is convenient to divide a day into blocks of 4 hours because it splits
// a day into 6 parts." Anything shorter is played out in a scene, which keeps
// its own time.

// survival.tex "Day": "By default, a day has 24 hours."
export const ETS_PER_DAY = 6

// How many days end as the clock moves from one ET to the other.
export function getDaysEnded(from: number, to: number): number {
  return getDay(to) - getDay(from)
}

// survival.tex "Night and Darkness": whether the ET the clock is in falls in
// the night, the day's first `dayETs` ETs being daylight; outside time it is
// neither.
export function isNight(clock: number | null, dayETs: number): boolean {
  return clock !== null && clock % ETS_PER_DAY >= dayETs
}

// The day the clock is in, counted from 0.
export function getDay(clock: number): number {
  return Math.floor(clock / ETS_PER_DAY)
}

// The parties that feel time pass: in play, and on a timeline.
export function getPlayingParties(state: CampaignState): string[] {
  return Object.keys(state.parties).filter((pid) => state.parties[pid].active && state.parties[pid].clock !== null)
}

// The clock of the character's party; none for one outside time or in no
// party.
export function getClockOf(state: CampaignState, id: string): number | null {
  return state.parties[state.partyOf[id]]?.clock ?? null
}

// Why time cannot pass now for the parties that feel it: there are none, or
// one of theirs is in a fight, which is counted in rounds until it is over.
export function getTimeBar(state: CampaignState): string | null {
  const playing = getPlayingParties(state)
  if (playing.length === 0) return 'no party in play is on a timeline'
  return getAway(state).some((id) => playing.includes(state.partyOf[id])) ? 'someone is in a fight' : null
}

// The moment the clock reads, as the table says it: the day and the ET of
// that day, both counted from 1.
export function describeClock(clock: number): string {
  return `day ${getDay(clock) + 1}, ET ${(clock % ETS_PER_DAY) + 1}`
}

// Why these parties should not meet yet: they are on different timelines,
// and the table syncs them first. A party outside time meets anyone.
export function getTimelineClash(state: CampaignState, partyIds: readonly string[]): string | null {
  const timed = [...new Set(partyIds)].map((pid) => state.parties[pid]).filter((p) => p && p.clock !== null)
  if (new Set(timed.map((p) => p.clock)).size < 2) return null
  return `on different timelines: ${timed.map((p) => `${p.name} at ${describeClock(p.clock as number)}`).join(', ')}; sync them before they meet`
}
