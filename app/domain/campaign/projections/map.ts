import type { CampaignState, CrawlEvent, CrawlMap, EventTemplate, Party, Settlement, Terrain, TerrainValues, Way } from '../types'
import { getNodeTerrain, getTerrainPresets } from '../rules/terrain'
import { getEvent, getEventTemplates, hasEventTemplate } from '../rules/events'
import { getPartiesOn } from '../rules/place'
import { MAP_HEIGHT, MAP_WIDTH, getNodePositions } from '../rules/layout'

// An event as the editor shows it: what it is made of, the template it is
// made of (and whether the catalog still has it), the stage it is in, and
// which of its values it changed itself.
export type EventView = EventTemplate & {
  id: string
  template: string | null
  missing: boolean
  custom: (keyof EventTemplate)[]
}
export type PathEventView = EventView & { way: Way }

export function getEventView(id: string, event: CrawlEvent): EventView {
  return {
    ...getEvent(event), id, template: event.template, missing: event.template !== null && !hasEventTemplate(event.template),
    custom: event.template ? (Object.keys(event.custom) as (keyof EventTemplate)[]) : [],
  }
}
export type NodeEditorView = {
  id: string
  name: string
  terrain: string | null
  settlement: Settlement | null
  // the knowledge the node names itself, none to take the map's
  knowledge: string | null
  // what the node is made of, and which of those values it changed itself
  values: Terrain | null
  custom: (keyof TerrainValues)[]
  events: EventView[]
  // why the node cannot be taken off the map, if it cannot
  removeBar: string | null
}
// The map as it is drawn: each node where it sits, each path between the
// places of its two nodes with the middle to write on, what each holds counted.
export type MapGraphView = {
  width: number
  height: number
  nodes: { id: string; name: string; x: number; y: number; terrain: string | null; settlement: boolean; events: number; parties: string[] }[]
  edges: { id: string; a: string; b: string; ax: number; ay: number; bx: number; by: number; mx: number; my: number; DL: number; backDL: number; events: number }[]
}
export type MapEditorView = {
  name: string
  knowledge: string
  graph: MapGraphView
  presets: string[]
  // the event templates a new event can be made of
  templates: { key: string; name: string }[]
  nodes: NodeEditorView[]
  connections: { id: string; a: string; b: string; aName: string; bName: string; DL: number; backDL: number; events: PathEventView[] }[]
}


// The map as it is drawn, each node naming the parties in `on` standing on it.
export function getMapGraph(map: CrawlMap, on: Record<string, Party[]> = {}): MapGraphView {
  const at = getNodePositions(map)
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    nodes: Object.entries(map.nodes).map(([id, n]) => ({
      id, name: n.name, ...at[id], terrain: n.terrain, settlement: n.settlement !== null, events: Object.keys(n.events).length, parties: (on[id] ?? []).map((p) => p.name),
    })),
    edges: Object.entries(map.connections).flatMap(([id, c]) => {
      const a = at[c.a], b = at[c.b]
      return a && b ? [{ id, a: c.a, b: c.b, ax: a.x, ay: a.y, bx: b.x, by: b.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, DL: c.DL, backDL: c.backDL, events: Object.keys(c.events).length }] : []
    }),
  }
}

// survival.tex "Creating the point crawl" — the map being made, as lists to
// edit: each node with what it is made of, each path with the nodes it joins.
// A node the parties in `on` stand on stays while they are there.
export function getMapEditorView(map: CrawlMap, on: Record<string, Party[]> = {}): MapEditorView {
  const nodeName = (id: string) => map.nodes[id]?.name ?? id
  const removeBar = (id: string) => (on[id]?.length ? `${on[id].map((p) => p.name).join(', ')} ${on[id].length === 1 ? 'is' : 'are'} on it` : null)
  return {
    name: map.name,
    knowledge: map.knowledge,
    graph: getMapGraph(map, on),
    presets: getTerrainPresets(),
    templates: getEventTemplates(),
    nodes: Object.entries(map.nodes).map(([id, n]) => ({
      id, name: n.name, terrain: n.terrain, settlement: n.settlement, knowledge: n.knowledge, values: getNodeTerrain(n), custom: Object.keys(n.custom) as (keyof TerrainValues)[], events: Object.entries(n.events).map(([eventId, e]) => getEventView(eventId, e)),
      removeBar: removeBar(id),
    })),
    connections: Object.entries(map.connections).map(([id, c]) => ({
      id, a: c.a, b: c.b, aName: nodeName(c.a), bName: nodeName(c.b), DL: c.DL, backDL: c.backDL,
      events: Object.entries(c.events).map(([eventId, e]) => ({ ...getEventView(eventId, e), way: e.way })),
    })),
  }
}

// One of the campaign's maps to edit, each node saying who keeps it there;
// none for a map the campaign does not have.
export function getCampaignMapEditorView(state: CampaignState, mapId: string): MapEditorView | null {
  const map = state.maps[mapId]
  return map ? getMapEditorView(map, getPartiesOn(state, mapId)) : null
}
