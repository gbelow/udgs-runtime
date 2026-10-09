import type { Connection, CrawlEvent, CrawlNode, EventOwner, EventType, MapUpdater, Terrain, TerrainTag } from '../types'
import { ConnectionSchema, CrawlEventSchema, CrawlNodeSchema, TerrainSchema } from '../types'

// survival.tex "Creating the point crawl": the map is made by hand, terrains
// first, then nodes and the paths between them, then the events on both.

// The first "<label> n" none of the names has.
function nextName(label: string, names: string[]): string {
  let n = 1
  while (names.includes(`${label} ${n}`)) n++
  return `${label} ${n}`
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  const { [id]: _gone, ...rest } = record
  return rest
}

export function setMapName(name: string): MapUpdater {
  return (map) => ({ ...map, name })
}

export function addTerrain(newId: () => string): MapUpdater {
  return (map) => ({
    ...map,
    terrains: { ...map.terrains, [newId()]: TerrainSchema.parse({ name: nextName('Terrain', Object.values(map.terrains).map((t) => t.name)) }) },
  })
}

export function setTerrain(id: string, patch: Partial<Terrain>): MapUpdater {
  return (map) => (map.terrains[id] ? { ...map, terrains: { ...map.terrains, [id]: { ...map.terrains[id], ...patch } } } : map)
}

const toggled = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

export function toggleTerrainTag(id: string, tag: TerrainTag): MapUpdater {
  return (map) => (map.terrains[id] ? setTerrain(id, { tags: toggled(map.terrains[id].tags, tag) })(map) : map)
}

// Nodes made of it are left without a terrain.
export function removeTerrain(id: string): MapUpdater {
  return (map) => ({
    ...map,
    terrains: without(map.terrains, id),
    nodes: Object.fromEntries(Object.entries(map.nodes).map(([nid, n]) => [nid, n.terrain === id ? { ...n, terrain: null } : n])),
  })
}

export function addNode(newId: () => string): MapUpdater {
  return (map) => ({
    ...map,
    nodes: { ...map.nodes, [newId()]: CrawlNodeSchema.parse({ name: nextName('Node', Object.values(map.nodes).map((n) => n.name)) }) },
  })
}

export function setNode(id: string, patch: Partial<Pick<CrawlNode, 'name' | 'terrain'>>): MapUpdater {
  return (map) => (map.nodes[id] ? { ...map, nodes: { ...map.nodes, [id]: { ...map.nodes[id], ...patch } } } : map)
}

// The paths to and from it go with it.
export function removeNode(id: string): MapUpdater {
  return (map) => ({
    ...map,
    nodes: without(map.nodes, id),
    connections: Object.fromEntries(Object.entries(map.connections).filter(([, c]) => c.a !== id && c.b !== id)),
  })
}

// A path between two different nodes of the map.
export function addConnection(a: string, b: string, newId: () => string): MapUpdater {
  return (map) => (a === b || !map.nodes[a] || !map.nodes[b] ? map
    : { ...map, connections: { ...map.connections, [newId()]: ConnectionSchema.parse({ a, b }) } })
}

export function setConnection(id: string, patch: Partial<Pick<Connection, 'DL'>>): MapUpdater {
  return (map) => (map.connections[id] ? { ...map, connections: { ...map.connections, [id]: { ...map.connections[id], ...patch } } } : map)
}

export function removeConnection(id: string): MapUpdater {
  return (map) => ({ ...map, connections: without(map.connections, id) })
}

// The events of a node or a connection, changed in place.
function withEvents(owner: EventOwner, update: (events: Record<string, CrawlEvent>) => Record<string, CrawlEvent>): MapUpdater {
  return (map) => {
    if (owner.kind === 'node') {
      const node = map.nodes[owner.id]
      return node ? { ...map, nodes: { ...map.nodes, [owner.id]: { ...node, events: update(node.events) } } } : map
    }
    const connection = map.connections[owner.id]
    return connection ? { ...map, connections: { ...map.connections, [owner.id]: { ...connection, events: update(connection.events) } } } : map
  }
}

export function addEvent(owner: EventOwner, newId: () => string): MapUpdater {
  return withEvents(owner, (events) => ({
    ...events,
    [newId()]: CrawlEventSchema.parse({ name: nextName('Event', Object.values(events).map((e) => e.name)) }),
  }))
}

export function setEvent(owner: EventOwner, eventId: string, patch: Partial<CrawlEvent>): MapUpdater {
  return withEvents(owner, (events) => (events[eventId] ? { ...events, [eventId]: { ...events[eventId], ...patch } } : events))
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
