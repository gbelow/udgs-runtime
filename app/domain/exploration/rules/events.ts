import type { Degree } from '../../types'
import type { CrawlEvent, EventOutcome, EventStage } from '../../campaign/types'

// survival.tex "Random event": "put all available events in a numbered list
// and roll ... Leave numbers blank or add some events multiple times." The
// list is made here: an event is listed more often the easier it is to find,
// 5 times at DL -5 down to once at DL 15, and the blanks weigh 3.
export function getEventWeight(DL: number): number {
  return Math.max(1, 1 + (15 - DL) / 5)
}

export const BLANK_WEIGHT = 3

// The entry a percentile roll (0 to 99) lands on in a weighted list.
export function drawWeighted<T>(entries: { weight: number; item: T }[], percent: number): T | null {
  const total = entries.reduce((sum, e) => sum + e.weight, 0)
  let at = ((percent + 0.5) / 100) * total
  for (const e of entries) {
    if (at < e.weight) return e.item
    at -= e.weight
  }
  return null
}

// The stage the event is in, or null for one left with none.
export function getStage(event: CrawlEvent): EventStage | null {
  return event.stages[event.stage] ?? event.stages[0] ?? null
}

// The DL an exploration score is read against for an event: its stage's,
// with the night on top.
export function getEventDL(stage: EventStage, night: number): number {
  return stage.DL + night
}

// Whether what an event came to waits on the table before it lands: it
// asks a test of everyone present, whose DL the table may change for what
// they do.
export function asksTable(outcome: EventOutcome): boolean {
  return outcome.test !== null
}

// survival.tex "Search": "Characters find the easiest event of the type that
// was searched for and for which their test value was high enough", taken
// as a hit or better against it.
export function isFound(degree: Degree): boolean {
  return degree === 'hit' || degree === 'critical'
}
