import type { CampaignState, Party, Sequence } from '../types'
import { isPartyAway } from './place'

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

// The party is running on a timeline, and so in its sequence; frozen or
// outside time it is in none.
export function isPlaying(party: Party): boolean {
  return party.active && party.clock !== null
}

// Why the party is in no sequence yet, so that only the scene is open to it:
// it is not in the timeline, or frozen on it.
export function getPlayBar(state: CampaignState, partyId: string): string | null {
  const party = state.parties[partyId]
  if (!party) return 'no such party'
  if (party.clock === null) return 'not in the timeline: place it on the timeline and set it running first'
  return party.active ? null : 'frozen: set it running on its timeline first'
}

// The parties that feel time pass: running, and on a timeline; those of one
// `sequence` when it is named.
export function getPlayingParties(state: CampaignState, sequence?: Sequence): string[] {
  return Object.keys(state.parties).filter((pid) => {
    const party = state.parties[pid]
    return isPlaying(party) && (sequence === undefined || party.sequence === sequence)
  })
}

// Why the party, if there is one, is not in `sequence`: it is in the other.
export function getSequenceBar(state: CampaignState, partyId: string | undefined, sequence: Sequence): string | null {
  const party = partyId ? state.parties[partyId] : undefined
  return party && party.sequence !== sequence ? `in ${party.sequence}` : null
}

// The clock of the character's party; none for one outside time or in no
// party.
export function getClockOf(state: CampaignState, id: string): number | null {
  return state.parties[state.partyOf[id]]?.clock ?? null
}

// Why time cannot pass now for the parties of `sequence` that feel it: there
// are none, or one of theirs is in a fight, which is counted in rounds until
// it is over.
export function getTimeBar(state: CampaignState, sequence: Sequence): string | null {
  const playing = getPlayingParties(state, sequence)
  if (playing.length === 0) return `no party running on a timeline is in ${sequence}`
  return playing.some((pid) => isPartyAway(state, pid)) ? 'someone is in a fight' : null
}

// The moment the clock reads, as the table says it: the day and the ET of
// that day, both counted from 1.
export function describeClock(clock: number): string {
  return `day ${getDay(clock) + 1}, ET ${(clock % ETS_PER_DAY) + 1}`
}

// The clock at the day and the ET of that day, both counted from 1.
export function getClockAt(day: number, et: number): number {
  return Math.max(0, Math.round(day) - 1) * ETS_PER_DAY + Math.min(ETS_PER_DAY, Math.max(1, Math.round(et))) - 1
}

// A stretch of time as days and ETs.
export function describeSpan(ETs: number): string {
  const days = Math.floor(ETs / ETS_PER_DAY)
  const rest = ETs % ETS_PER_DAY
  return [days ? `${days} day${days === 1 ? '' : 's'}` : '', rest ? `${rest} ET${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ')
}

// Why these parties should not meet yet: they are on different timelines,
// and the table syncs them first. A party outside time meets anyone.
export function getTimelineClash(state: CampaignState, partyIds: readonly string[]): string | null {
  const timed = [...new Set(partyIds)].map((pid) => state.parties[pid]).filter((p) => p && p.clock !== null)
  if (new Set(timed.map((p) => p.clock)).size < 2) return null
  return `on different timelines: ${timed.map((p) => `${p.name} at ${describeClock(p.clock as number)}`).join(', ')}; sync them before they meet`
}
