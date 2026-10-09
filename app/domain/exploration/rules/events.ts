import type { Degree } from '../../types'
import type { CampaignState, CrawlEvent } from '../../campaign/types'
import { getKnowledge } from '../../character/rules/knowledge'

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

// creating.tex "Knowledge as Enabler": "a penalty of -5 per missing
// knowledge level", the knowledge held by "any member of the team that is
// present in the exploration action".
export function getEnablerPenalty(state: CampaignState, present: string[], event: CrawlEvent): number {
  if (!event.enabler) return 0
  const { knowledge, level } = event.enabler
  const best = Math.max(0, ...present.map((id) => getKnowledge(knowledge)(state.characters[id])))
  return 5 * Math.max(0, level - best)
}

// The DL an exploration score is read against for an event: its own, with
// the night and any missing knowledge on top.
export function getEventDL(state: CampaignState, present: string[], night: number, event: CrawlEvent): number {
  return event.DL + night + getEnablerPenalty(state, present, event)
}

// survival.tex "Search": "Characters find the easiest event of the type that
// was searched for and for which their test value was high enough", taken
// as a hit or better against it.
export function isFound(degree: Degree): boolean {
  return degree === 'hit' || degree === 'critical'
}
