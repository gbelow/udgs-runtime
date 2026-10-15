import type { CampaignState, CrawlEvent, CrawlMap, Party, PathEvent, Settlement, Terrain, TerrainValues } from '../types'
import { getNodeTerrain, getTerrainPresets } from '../rules/terrain'
import { getPartiesOn } from '../rules/place'

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
  // why the node cannot be taken off the map, if it cannot
  removeBar: string | null
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
// A node the parties in `on` stand on stays while they are there.
export function getMapEditorView(map: CrawlMap, on: Record<string, Party[]> = {}): MapEditorView {
  const nodeName = (id: string) => map.nodes[id]?.name ?? id
  const removeBar = (id: string) => (on[id]?.length ? `${on[id].map((p) => p.name).join(', ')} ${on[id].length === 1 ? 'is' : 'are'} on it` : null)
  return {
    name: map.name,
    presets: getTerrainPresets(),
    nodes: Object.entries(map.nodes).map(([id, n]) => ({
      id, name: n.name, terrain: n.terrain, settlement: n.settlement, values: getNodeTerrain(n), custom: Object.keys(n.custom) as (keyof TerrainValues)[], events: withIds(n.events),
      removeBar: removeBar(id),
    })),
    connections: Object.entries(map.connections).map(([id, c]) => ({
      id, a: c.a, b: c.b, aName: nodeName(c.a), bName: nodeName(c.b), DL: c.DL, backDL: c.backDL, events: withIds(c.events),
    })),
  }
}

// One of the campaign's maps to edit, each node saying who keeps it there;
// none for a map the campaign does not have.
export function getCampaignMapEditorView(state: CampaignState, mapId: string): MapEditorView | null {
  const map = state.maps[mapId]
  return map ? getMapEditorView(map, getPartiesOn(state, mapId)) : null
}
