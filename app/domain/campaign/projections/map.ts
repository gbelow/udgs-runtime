import type { CrawlEvent, CrawlMap, PathEvent, Settlement, Terrain, TerrainValues } from '../types'
import { getNodeTerrain, getTerrainPresets } from '../rules/terrain'

export type EventView = CrawlEvent & { id: string }
export type PathEventView = PathEvent & { id: string }
export type NodeEditorView = {
  id: string
  name: string
  terrain: string | null
  settlement: Settlement | null
  // what the node is made of, and which of those values it changed itself
  values: Terrain | null
  custom: (keyof TerrainValues)[]
  events: EventView[]
}
export type MapEditorView = {
  name: string
  presets: string[]
  nodes: NodeEditorView[]
  connections: { id: string; a: string; b: string; aName: string; bName: string; DL: number; backDL: number; events: PathEventView[] }[]
}

const withIds = <E,>(events: Record<string, E>): (E & { id: string })[] => Object.entries(events).map(([id, e]) => ({ ...e, id }))

// survival.tex "Creating the point crawl" — the map being made, as lists to
// edit: each node with what it is made of, each path with the nodes it joins.
export function getMapEditorView(map: CrawlMap): MapEditorView {
  const nodeName = (id: string) => map.nodes[id]?.name ?? id
  return {
    name: map.name,
    presets: getTerrainPresets(),
    nodes: Object.entries(map.nodes).map(([id, n]) => ({
      id, name: n.name, terrain: n.terrain, settlement: n.settlement, values: getNodeTerrain(n), custom: Object.keys(n.custom) as (keyof TerrainValues)[], events: withIds(n.events),
    })),
    connections: Object.entries(map.connections).map(([id, c]) => ({
      id, a: c.a, b: c.b, aName: nodeName(c.a), bName: nodeName(c.b), DL: c.DL, backDL: c.backDL, events: withIds(c.events),
    })),
  }
}
