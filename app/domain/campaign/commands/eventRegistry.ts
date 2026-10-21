import { editsOver, toEdit, type EditOf } from '../../registry'
import type { Degree } from '../../types'
import type { EventOutcome, EventStage, EventTemplate, EventType } from '../types'
import { addStage, removeStage, resetEventValue, setEventName, setEventStage, setOutcome, setStage, toggleStageType, type EventUpdater } from './event'

// The event editor's changes, as data, so the same edit is made to an event
// on a map and to a template in the catalog.

const edit = editsOver<void, EventUpdater>()

export const eventCommands = {
  setEventName: edit((_, name: string) => setEventName(name)),
  setEventStage: edit((_, index: number) => setEventStage(index)),
  addStage: edit(() => addStage()),
  removeStage: edit((_, index: number) => removeStage(index)),
  setStage: edit((_, index: number, patch: Partial<Pick<EventStage, 'name' | 'DL'>>) => setStage(index, patch)),
  toggleStageType: edit((_, index: number, type: EventType) => toggleStageType(index, type)),
  setOutcome: edit((_, index: number, degree: Degree, patch: Partial<EventOutcome>) => setOutcome(index, degree, patch)),
  resetEventValue: edit((_, key: keyof EventTemplate) => resetEventValue(key)),
}

export type EventCommand = EditOf<typeof eventCommands>

export const toEventUpdater = (command: EventCommand): EventUpdater => toEdit<void, EventUpdater>(eventCommands, command, undefined)
