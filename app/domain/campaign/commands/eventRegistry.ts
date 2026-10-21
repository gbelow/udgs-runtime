import { editsOver, toEdit, type EditOf } from '../../registry'
import type { Degree } from '../../types'
import type { EventOutcome, EventTemplate, EventType } from '../types'
import { resetEventValue, setEvent, setOutcome, toggleEventType, type EventPatch, type EventUpdater } from './event'

// The event editor's changes, as data, so the same edit is made to an event
// on a map and to a template in the catalog.

const edit = editsOver<void, EventUpdater>()

export const eventCommands = {
  setEvent: edit((_, patch: EventPatch) => setEvent(patch)),
  toggleEventType: edit((_, type: EventType) => toggleEventType(type)),
  setOutcome: edit((_, degree: Degree, patch: Partial<EventOutcome>) => setOutcome(degree, patch)),
  resetEventValue: edit((_, key: keyof EventTemplate) => resetEventValue(key)),
}

export type EventCommand = EditOf<typeof eventCommands>

export const toEventUpdater = (command: EventCommand): EventUpdater => toEdit<void, EventUpdater>(eventCommands, command, undefined)
