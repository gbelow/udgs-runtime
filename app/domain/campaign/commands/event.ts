import type { Degree } from '../../types'
import type { CrawlEvent, EventOutcome, EventTemplate, EventType } from '../types'
import { getEvent } from '../rules/events'

// survival.tex "Events": an event made by hand, the same on a map and in the
// events catalog. What it changes is kept on the event, value by value, over
// the template it is made of.

export type EventUpdater = (event: CrawlEvent) => CrawlEvent

const toggled = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

export type EventPatch = Partial<Pick<EventTemplate, 'name' | 'text' | 'DL' | 'shelter' | 'ambient' | 'renews'>>

export function setEvent(patch: EventPatch): EventUpdater {
  return (e) => ({ ...e, custom: { ...e.custom, ...patch } })
}

export function toggleEventType(type: EventType): EventUpdater {
  return (e) => ({ ...e, custom: { ...e.custom, types: toggled(getEvent(e).types, type) } })
}

// What the event comes to at one degree; the outcomes are taken over from
// the template together.
export function setOutcome(degree: Degree, patch: Partial<EventOutcome>): EventUpdater {
  return (e) => {
    const { outcomes } = getEvent(e)
    return { ...e, custom: { ...e.custom, outcomes: { ...outcomes, [degree]: { ...outcomes[degree], ...patch } } } }
  }
}

// survival.tex "Events": what its outcomes find, taken off it once found,
// unless it renews.
export const takeItems: EventUpdater = (e) => {
  const { outcomes, renews } = getEvent(e)
  if (renews || Object.values(outcomes).every((o) => o.items.length === 0)) return e
  const emptied = (o: EventOutcome): EventOutcome => ({ ...o, items: [] })
  return { ...e, custom: { ...e.custom, outcomes: { critical: emptied(outcomes.critical), hit: emptied(outcomes.hit), graze: emptied(outcomes.graze), miss: emptied(outcomes.miss) } } }
}

// The event takes this from its template again.
export function resetEventValue(key: keyof EventTemplate): EventUpdater {
  return (e) => {
    const { [key]: _gone, ...custom } = e.custom
    return { ...e, custom }
  }
}
