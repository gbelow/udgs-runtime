import type { Connection, CrawlEvent, CrawlNode, EventOwner, EventType, MapUpdater, PathEvent, TerrainTag, TerrainValues, TerrainWear, Way } from '../types'
import { ConnectionSchema, CrawlEventSchema, CrawlNodeSchema, PathEventSchema, SettlementSchema, TerrainWearSchema } from '../types'
import { getNodeTerrain } from '../rules/terrain'
import { clampToMap, getFreeSpot, getPlacedMap, type Point } from '../rules/layout'
import { without } from '../../utils'

// survival.tex "Creating the point crawl": the map is made by hand, nodes
// first, each made of a terrain from the catalog, then the paths between
// them, then the events on both.

// The first "<label> n" none of the names has.
function nextName(label: string, names: string[]): string {
  let n = 1
  while (names.includes(`${label} ${n}`)) n++
  return `${label} ${n}`
}

const toggled = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

export function setMapName(name: string): MapUpdater {
  return (map) => ({ ...map, name })
}

// The node goes where it is put, or to the first free spot.
export function addNode(newId: () => string, at?: Point): MapUpdater {
  return (drawn) => {
    const map = getPlacedMap(drawn)
    const { x, y } = clampToMap(at ?? getFreeSpot(map))
    return {
      ...map,
      nodes: { ...map.nodes, [newId()]: CrawlNodeSchema.parse({ name: nextName('Node', Object.values(map.nodes).map((n) => n.name)), x, y }) },
    }
  }
}

const withNode = (id: string, update: (n: CrawlNode) => CrawlNode): MapUpdater =>
  (map) => (map.nodes[id] ? { ...map, nodes: { ...map.nodes, [id]: update(map.nodes[id]) } } : map)

export function moveNode(id: string, to: Point): MapUpdater {
  return (map) => withNode(id, (n) => ({ ...n, ...clampToMap(to) }))(getPlacedMap(map))
}

// The node's name, or the terrain preset it is made of; what it changed of
// its terrain stays changed.
export function setNode(id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>): MapUpdater {
  return withNode(id, (n) => ({ ...n, ...patch }))
}

// The node becomes a settlement at the book's average cost of living, or
// stops being one.
export function toggleSettlement(id: string): MapUpdater {
  return withNode(id, (n) => ({ ...n, settlement: n.settlement ? null : SettlementSchema.parse({}) }))
}

// story.tex "Cost of Living": "The cost of living changes from town to town".
export function setSettlementLiving(id: string, living: number): MapUpdater {
  return withNode(id, (n) => (n.settlement ? { ...n, settlement: { ...n.settlement, living } } : n))
}

// The node changes these values of its terrain.
export function customizeNode(id: string, patch: Partial<TerrainValues>): MapUpdater {
  return withNode(id, (n) => ({ ...n, custom: { ...n.custom, ...patch } }))
}

// The node changes one part of its terrain's extra wear, keeping the rest.
export function customizeNodeWear(id: string, patch: Partial<TerrainWear>): MapUpdater {
  return withNode(id, (n) => {
    const wear = getNodeTerrain(n)?.wear ?? TerrainWearSchema.parse({})
    return { ...n, custom: { ...n.custom, wear: { ...wear, ...patch } } }
  })
}

export function toggleNodeTag(id: string, tag: TerrainTag): MapUpdater {
  return withNode(id, (n) => ({ ...n, custom: { ...n.custom, tags: toggled(getNodeTerrain(n)?.tags ?? [], tag) } }))
}

// The node takes this value from its terrain again.
export function resetNodeValue(id: string, key: keyof TerrainValues): MapUpdater {
  return withNode(id, (n) => {
    const { [key]: _gone, ...custom } = n.custom
    return { ...n, custom }
  })
}

// The paths to and from it go with it.
export function removeNode(id: string): MapUpdater {
  return (map) => ({
    ...map,
    nodes: without(map.nodes, id),
    connections: Object.fromEntries(Object.entries(map.connections).filter(([, c]) => c.a !== id && c.b !== id)),
  })
}

// A path between two different nodes of the map, with its DL each way.
export function addConnection(a: string, b: string, DL: number, backDL: number, newId: () => string): MapUpdater {
  return (map) => (a === b || !map.nodes[a] || !map.nodes[b] ? map
    : { ...map, connections: { ...map.connections, [newId()]: ConnectionSchema.parse({ a, b, DL, backDL }) } })
}

export function setConnection(id: string, patch: Partial<Pick<Connection, 'DL' | 'backDL'>>): MapUpdater {
  return (map) => (map.connections[id] ? { ...map, connections: { ...map.connections, [id]: { ...map.connections[id], ...patch } } } : map)
}

export function removeConnection(id: string): MapUpdater {
  return (map) => ({ ...map, connections: without(map.connections, id) })
}

const withPath = (id: string, update: (events: Record<string, PathEvent>) => Record<string, PathEvent>): MapUpdater =>
  (map) => (map.connections[id] ? { ...map, connections: { ...map.connections, [id]: { ...map.connections[id], events: update(map.connections[id].events) } } } : map)

// The events of a node or a path, changed in place.
function withEvents(owner: EventOwner, update: <E extends CrawlEvent>(events: Record<string, E>) => Record<string, E>): MapUpdater {
  return owner.kind === 'node' ? withNode(owner.id, (n) => ({ ...n, events: update(n.events) })) : withPath(owner.id, update)
}

export function addEvent(owner: EventOwner, newId: () => string): MapUpdater {
  return (map) => {
    const events = owner.kind === 'node' ? map.nodes[owner.id]?.events : map.connections[owner.id]?.events
    const name = nextName('Event', Object.values(events ?? {}).map((e) => e.name))
    return owner.kind === 'node'
      ? withNode(owner.id, (n) => ({ ...n, events: { ...n.events, [newId()]: CrawlEventSchema.parse({ name }) } }))(map)
      : withPath(owner.id, (es) => ({ ...es, [newId()]: PathEventSchema.parse({ name }) }))(map)
  }
}

export function setEvent(owner: EventOwner, eventId: string, patch: Partial<CrawlEvent>): MapUpdater {
  return withEvents(owner, (events) => (events[eventId] ? { ...events, [eventId]: { ...events[eventId], ...patch } } : events))
}

// Which way along the path the event happens.
export function setEventWay(connectionId: string, eventId: string, way: Way): MapUpdater {
  return withPath(connectionId, (events) => (events[eventId] ? { ...events, [eventId]: { ...events[eventId], way } } : events))
}

export function removeEvent(owner: EventOwner, eventId: string): MapUpdater {
  return withEvents(owner, (events) => without(events, eventId))
}

export function toggleEventType(owner: EventOwner, eventId: string, type: EventType): MapUpdater {
  return withEvents(owner, (events) => (events[eventId] ? { ...events, [eventId]: { ...events[eventId], types: toggled(events[eventId].types, type) } } : events))
}

// creating.tex "Knowledge as Enabler": the knowledge and level the event
// needs; none without a knowledge named.
export function setEnabler(owner: EventOwner, eventId: string, knowledge: string, level: number): MapUpdater {
  return setEvent(owner, eventId, { enabler: knowledge.trim() ? { knowledge: knowledge.trim(), level } : null })
}
