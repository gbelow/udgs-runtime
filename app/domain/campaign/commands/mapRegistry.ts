import { editsOver, toEdit, type EditOf } from '../../registry'
import type { Point } from '../rules/layout'
import type { Connection, CrawlEvent, CrawlNode, EventOwner, EventType, MapUpdater, TerrainTag, TerrainValues, TerrainWear, Way } from '../types'
import {
  addConnection, addEvent, addNode, moveNode, customizeNode, customizeNodeWear, removeConnection, removeEvent, removeNode, resetNodeValue, setConnection, setEnabler,
  setEvent, setEventWay, setMapName, setNode, setSettlementLiving, toggleEventType, toggleSettlement, toggleNodeTag,
} from './map'

// The map editor's changes, as data, so that one made to a campaign's map on
// one screen can be played on another; the ids are the table's.

export type MapContext = { newId: () => string }

const edit = editsOver<MapContext, MapUpdater>()

export const mapCommands = {
  setMapName: edit((_, name: string) => setMapName(name)),
  addNode: edit((ctx, at?: Point) => addNode(ctx.newId, at)),
  moveNode: edit((_, id: string, to: Point) => moveNode(id, to)),
  setNode: edit((_, id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>) => setNode(id, patch)),
  toggleSettlement: edit((_, id: string) => toggleSettlement(id)),
  setSettlementLiving: edit((_, id: string, living: number) => setSettlementLiving(id, living)),
  customizeNode: edit((_, id: string, patch: Partial<TerrainValues>) => customizeNode(id, patch)),
  customizeNodeWear: edit((_, id: string, patch: Partial<TerrainWear>) => customizeNodeWear(id, patch)),
  toggleNodeTag: edit((_, id: string, tag: TerrainTag) => toggleNodeTag(id, tag)),
  resetNodeValue: edit((_, id: string, key: keyof TerrainValues) => resetNodeValue(id, key)),
  removeNode: edit((_, id: string) => removeNode(id)),
  addConnection: edit((ctx, a: string, b: string, DL: number, backDL: number) => addConnection(a, b, DL, backDL, ctx.newId)),
  setConnection: edit((_, id: string, patch: Partial<Pick<Connection, 'DL' | 'backDL'>>) => setConnection(id, patch)),
  setEventWay: edit((_, connectionId: string, eventId: string, way: Way) => setEventWay(connectionId, eventId, way)),
  removeConnection: edit((_, id: string) => removeConnection(id)),
  addEvent: edit((ctx, owner: EventOwner) => addEvent(owner, ctx.newId)),
  setEvent: edit((_, owner: EventOwner, eventId: string, patch: Partial<CrawlEvent>) => setEvent(owner, eventId, patch)),
  toggleEventType: edit((_, owner: EventOwner, eventId: string, type: EventType) => toggleEventType(owner, eventId, type)),
  setEnabler: edit((_, owner: EventOwner, eventId: string, knowledge: string, level: number) => setEnabler(owner, eventId, knowledge, level)),
  removeEvent: edit((_, owner: EventOwner, eventId: string) => removeEvent(owner, eventId)),
}

export type MapCommand = EditOf<typeof mapCommands>

export const toMapUpdater = (command: MapCommand, ctx: MapContext): MapUpdater => toEdit<MapContext, MapUpdater>(mapCommands, command, ctx)
