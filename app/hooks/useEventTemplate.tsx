import { CrawlEventSchema, EventTemplateSchema } from "../domain/campaign/types";
import { getEvent } from "../domain/campaign/rules/events";
import { getEventView, type EventView } from "../domain/campaign/projections/map";
import { toEventUpdater, type EventCommand } from "../domain/campaign/commands/eventRegistry";

// A template of the events catalog in its editor: the draft read as an event
// made of nothing but itself, so the map's own event edits make it, and
// written back as the template it now is.
export function useEventTemplateDraft(value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void): { view: EventView; edit: (command: EventCommand) => void } {
  const event = CrawlEventSchema.parse({ custom: EventTemplateSchema.parse(value) });
  return {
    view: getEventView('', event),
    edit: (command) => onChange(getEvent(toEventUpdater(command)(event))),
  };
}
