import { z } from 'zod'
import eventCatalog from '../../../assets/events.json'
import { EventTemplateSchema, type CrawlEvent, type EventTemplate } from '../types'

// survival.tex "Events": the templates events are made of, kept outside any
// map, as terrains are.
const TEMPLATES: Record<string, EventTemplate> = z.record(z.string(), EventTemplateSchema).parse(eventCatalog)

export function getEventTemplates(): { key: string; name: string }[] {
  return Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name || key }))
}

export function hasEventTemplate(key: string): boolean {
  return key in TEMPLATES
}

// What an event is made of: its template with what the event changes of it
// on top, read afresh so that a change to the template reaches every event
// that keeps its value. A template gone from the catalog leaves only the
// changes.
export function getEvent(event: CrawlEvent): EventTemplate {
  const template = event.template ? TEMPLATES[event.template] : undefined
  return { ...EventTemplateSchema.parse({ name: event.template ?? '' }), ...template, ...event.custom }
}
