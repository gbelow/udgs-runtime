import { editsOver, toEdit, type EditOf } from '../../registry'
import type { Point } from '../rules/layout'
import type { Connection, CrawlNode, EventOwner, MapUpdater, TerrainTag, TerrainValues, Wear, Way } from '../types'
import { toEventUpdater, type EventCommand } from './eventRegistry'
import {
  addConnection, addEvent, addNode, moveNode, customizeNode, customizeNodeWear, editEvent, removeConnection, removeEvent, removeNode, resetNodeValue, setConnection,
  setEventWay, setMapKnowledge, setMapName, setNode, setNodeKnowledge, setSettlementLiving, toggleSettlement, toggleNodeTag,
} from './map'

// The map editor's changes, as data, so that one made to a campaign's map on
// one screen can be played on another; the ids are the table's.

export type MapContext = { newId: () => string }

const edit = editsOver<MapContext, MapUpdater>()

export const mapCommands = {
  setMapName: edit((_, name: string) => setMapName(name)),
  setMapKnowledge: edit((_, knowledge: string) => setMapKnowledge(knowledge)),
  setNodeKnowledge: edit((_, id: string, knowledge: string | null) => setNodeKnowledge(id, knowledge)),
  addNode: edit((ctx, at?: Point) => addNode(ctx.newId, at)),
  moveNode: edit((_, id: string, to: Point) => moveNode(id, to)),
  setNode: edit((_, id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>) => setNode(id, patch)),
  toggleSettlement: edit((_, id: string) => toggleSettlement(id)),
  setSettlementLiving: edit((_, id: string, living: number) => setSettlementLiving(id, living)),
  customizeNode: edit((_, id: string, patch: Partial<TerrainValues>) => customizeNode(id, patch)),
  customizeNodeWear: edit((_, id: string, patch: Partial<Wear>) => customizeNodeWear(id, patch)),
  toggleNodeTag: edit((_, id: string, tag: TerrainTag) => toggleNodeTag(id, tag)),
  resetNodeValue: edit((_, id: string, key: keyof TerrainValues) => resetNodeValue(id, key)),
  removeNode: edit((_, id: string) => removeNode(id)),
  addConnection: edit((ctx, a: string, b: string, DL: number, backDL: number) => addConnection(a, b, DL, backDL, ctx.newId)),
  setConnection: edit((_, id: string, patch: Partial<Pick<Connection, 'DL' | 'backDL'>>) => setConnection(id, patch)),
  setEventWay: edit((_, connectionId: string, eventId: string, way: Way) => setEventWay(connectionId, eventId, way)),
  removeConnection: edit((_, id: string) => removeConnection(id)),
  addEvent: edit((ctx, owner: EventOwner, template: string | null) => addEvent(owner, template, ctx.newId)),
  editEvent: edit((_, owner: EventOwner, eventId: string, command: EventCommand) => editEvent(owner, eventId, toEventUpdater(command))),
  removeEvent: edit((_, owner: EventOwner, eventId: string) => removeEvent(owner, eventId)),
}

export type MapCommand = EditOf<typeof mapCommands>

export const toMapUpdater = (command: MapCommand, ctx: MapContext): MapUpdater => toEdit<MapContext, MapUpdater>(mapCommands, command, ctx)
