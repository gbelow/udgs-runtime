import type { Party, SeenCampaign } from '../../campaign/types'
import type { Exploring, ExplorationState } from '../types'
import { getMapGraph, type MapGraphView } from '../../campaign/projections/map'
import { isPlaying } from '../../campaign/rules/clock'
import { getConnectionsFrom, getPlace } from '../../campaign/rules/place'
import { getGroups } from '../rules/exploration'
import { perPair } from '../../perState'

// A party that can set out along a path: where the path takes it from where
// it stands, the DL that way, and whether a travel group of it is set on it.
export type TravelOption = { partyId: string; party: string; to: string; DL: number; planned: boolean }
export type ExplorationMapView = {
  id: string
  name: string
  graph: MapGraphView
  // by path, the parties at either end of it
  travels: Record<string, TravelOption[]>
  // the paths a travel group is set on
  planned: string[]
}

// survival.tex "Point crawl": the maps the exploring parties stand on, as the
// table plays them, each path offering a travel to the parties at its ends.
const mapsView = perPair(({ a: state, b: exploration }: { a: SeenCampaign; b: ExplorationState }): ExplorationMapView[] => {
  const t: Exploring = { campaign: state, exploration }
  const exploring = Object.entries(state.parties).filter(([, p]) => isPlaying(p) && p.sequence === 'exploration' && p.at && state.maps[p.at.map])
  const mapIds = [...new Set(exploring.map(([, p]) => p.at!.map))]
  return mapIds.map((mapId) => {
    const on: Record<string, Party[]> = {}
    const travels: Record<string, TravelOption[]> = {}
    const planned = new Set<string>()
    for (const [partyId, party] of exploring.filter(([, p]) => p.at!.map === mapId)) {
      on[party.at!.node] = [...(on[party.at!.node] ?? []), party]
      const place = getPlace(state, party)
      if (!place) continue
      const targets = Object.values(getGroups(t, partyId)).filter((g) => g.kind === 'travel').map((g) => g.target)
      for (const path of getConnectionsFrom(place)) {
        const set = targets.includes(path.id)
        if (set) planned.add(path.id)
        travels[path.id] = [...(travels[path.id] ?? []), { partyId, party: party.name, to: path.toName, DL: path.DL, planned: set }]
      }
    }
    return { id: mapId, name: state.maps[mapId].name, graph: getMapGraph(state.maps[mapId], on), travels, planned: [...planned] }
  })
})

const mapsDigest = perPair(({ a, b }: { a: SeenCampaign; b: ExplorationState }) => JSON.stringify(mapsView(a, b)))

export const getExplorationMaps = (t: Exploring & { campaign: SeenCampaign }): ExplorationMapView[] => mapsView(t.campaign, t.exploration)

// Everything the maps display, as one string to gate their render on.
export const getExplorationMapsDigest = (t: Exploring & { campaign: SeenCampaign }): string => mapsDigest(t.campaign, t.exploration)
