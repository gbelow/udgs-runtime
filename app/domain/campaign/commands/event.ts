import type { Degree } from '../../types'
import type { CrawlEvent, EventOutcome, EventStage, EventTemplate, EventType } from '../types'
import { EventStageSchema } from '../types'
import { getEvent } from '../rules/events'

// survival.tex "Events": an event made by hand, the same on a map and in the
// events catalog. What it changes is kept on the event; on one made of a
// template, a change to its stages takes them all over from the template.

export type EventUpdater = (event: CrawlEvent) => CrawlEvent

const toggled = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

const withStages = (update: (stages: EventStage[], stage: number) => { stages: EventStage[]; stage?: number }): EventUpdater =>
  (e) => {
    const changed = update(getEvent(e).stages, e.stage)
    return { ...e, stage: changed.stage ?? e.stage, custom: { ...e.custom, stages: changed.stages } }
  }

const withStage = (index: number, update: (stage: EventStage) => EventStage): EventUpdater =>
  (e) => (getEvent(e).stages[index] ? withStages((stages) => ({ stages: stages.map((s, i) => (i === index ? update(s) : s)) }))(e) : e)

export function setEventName(name: string): EventUpdater {
  return (e) => ({ ...e, custom: { ...e.custom, name } })
}

// The GM moves the event to another of its stages: the tree in fruit, the
// deer butchered, the treasure taken.
export function setEventStage(index: number): EventUpdater {
  return (e) => (getEvent(e).stages[index] ? { ...e, stage: index } : e)
}

export function addStage(): EventUpdater {
  return withStages((stages) => ({ stages: [...stages, EventStageSchema.parse({ name: `Stage ${stages.length + 1}` })] }))
}

// An event keeps one stage at least; the one it is in stays where it is.
export function removeStage(index: number): EventUpdater {
  return (e) => {
    const { stages } = getEvent(e)
    if (stages.length <= 1 || !stages[index]) return e
    return withStages((all, stage) => ({ stages: all.filter((_, i) => i !== index), stage: stage === index ? 0 : stage > index ? stage - 1 : stage }))(e)
  }
}

export function setStage(index: number, patch: Partial<Pick<EventStage, 'name' | 'DL' | 'shelter' | 'ambient'>>): EventUpdater {
  return withStage(index, (s) => ({ ...s, ...patch }))
}

export function toggleStageType(index: number, type: EventType): EventUpdater {
  return withStage(index, (s) => ({ ...s, types: toggled(s.types, type) }))
}

export function setOutcome(index: number, degree: Degree, patch: Partial<EventOutcome>): EventUpdater {
  return withStage(index, (s) => ({ ...s, outcomes: { ...s.outcomes, [degree]: { ...s.outcomes[degree], ...patch } } }))
}

// The event takes this from its template again.
export function resetEventValue(key: keyof EventTemplate): EventUpdater {
  return (e) => {
    const { [key]: _gone, ...custom } = e.custom
    const stage = key === 'stages' ? 0 : e.stage
    return { ...e, stage, custom }
  }
}
