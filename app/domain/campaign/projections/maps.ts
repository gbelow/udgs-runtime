import type { At, CampaignState, CrawlMap } from '../types'
import { perState } from '../../perState'
import { getPlaceKey } from '../rules/place'

export type CampaignMapView = { id: string; name: string; nodes: number; parties: string[] }

// A node a party can be put on, keyed for a picker.
export type NodeOption = { key: string; name: string; at: At }
export type MapOptions = { id: string; name: string; nodes: NodeOption[] }

// The key a picker of nodes knows the place by; none off the map.
export { getPlaceKey }

// The campaign's own maps, each with how many nodes it has and the parties
// standing on it.
export const getCampaignMaps = perState((state: CampaignState): CampaignMapView[] => {
  const on = new Map<string, string[]>()
  for (const p of Object.values(state.parties)) if (p.at) on.set(p.at.map, [...(on.get(p.at.map) ?? []), p.name])
  return Object.entries(state.maps).map(([id, map]) => ({ id, name: map.name, nodes: Object.keys(map.nodes).length, parties: on.get(id) ?? [] }))
})

export const getCampaignMapsDigest = perState((state: CampaignState) => JSON.stringify(getCampaignMaps(state)))

// Every node of the campaign's maps a party can be put on, map by map; kept
// for as long as the maps are, since play rarely changes them.
export const getNodeOptions = perState((maps: Record<string, CrawlMap>): MapOptions[] =>
  Object.entries(maps).map(([id, m]) => ({
    id, name: m.name,
    nodes: Object.entries(m.nodes).map(([node, n]) => ({ key: getPlaceKey({ map: id, node }), name: n.name, at: { map: id, node } })),
  })))
