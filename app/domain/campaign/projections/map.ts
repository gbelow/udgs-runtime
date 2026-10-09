import type { CrawlEvent, CrawlMap, Terrain } from '../types'

export type EventView = CrawlEvent & { id: string }
export type MapEditorView = {
  name: string
  terrains: (Terrain & { id: string })[]
  nodes: { id: string; name: string; terrain: string | null; events: EventView[] }[]
  connections: { id: string; a: string; b: string; name: string; DL: number; events: EventView[] }[]
}

const eventsOf = (events: Record<string, CrawlEvent>): EventView[] => Object.entries(events).map(([id, e]) => ({ ...e, id }))

// survival.tex "Creating the point crawl" — the map being made, as lists to
// edit, each path named by the nodes it joins.
export function getMapEditorView(map: CrawlMap): MapEditorView {
  const nodeName = (id: string) => map.nodes[id]?.name ?? id
  return {
    name: map.name,
    terrains: Object.entries(map.terrains).map(([id, t]) => ({ ...t, id })),
    nodes: Object.entries(map.nodes).map(([id, n]) => ({ id, name: n.name, terrain: n.terrain, events: eventsOf(n.events) })),
    connections: Object.entries(map.connections).map(([id, c]) => ({
      id, a: c.a, b: c.b, name: `${nodeName(c.a)} — ${nodeName(c.b)}`, DL: c.DL, events: eventsOf(c.events),
    })),
  }
}
