import type { CampaignState, Connection, CrawlNode, Party, PathEvent, Terrain, TerrainWear } from '../types'
import { TerrainWearSchema } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { getNodeTerrain } from './terrain'

export type Place = { id: string; node: CrawlNode; terrain: Terrain | null }

// The node of the map the party is on and what it is made of; null off the map.
export function getPlace(state: CampaignState, party: Party): Place | null {
  const node = party.node ? state.map?.nodes[party.node] : undefined
  if (!party.node || !node) return null
  return { id: party.node, node, terrain: getNodeTerrain(node) }
}

// survival.tex "Terrain": "Terrain can have value for extra wear. For
// example, spending an ET in the desert without shelter always inflicts an
// extra thirst" — paid every ET by everyone on the node, whatever they do;
// a shelter is a node of its own, with its own wear.
export function getTerrainWear(state: CampaignState, party: Party): TerrainWear {
  return getPlace(state, party)?.terrain?.wear ?? TerrainWearSchema.parse({})
}

// survival.tex "Terrain": "Every terrain has a value of exposure"; off the
// map, the table enters it.
export function getExposure(state: CampaignState, party: Party): number {
  const place = getPlace(state, party)
  return place?.terrain ? place.terrain.exposure : party.exposure
}

// survival.tex "Infection Exposure": the terrain's; off the map, the table
// enters it.
export function getInfectionExposure(state: CampaignState, party: Party): number {
  const place = getPlace(state, party)
  return place?.terrain ? place.terrain.infection : party.infection
}

export type Path = { id: string; connection: Connection; to: string; DL: number; events: PathEvent[] }

// The paths out of a node, each as travelled from it: the node at the other
// end, the DL that way, and the events met going that way.
export function getConnectionsFrom(state: CampaignState, node: string): Path[] {
  return Object.entries(state.map?.connections ?? {})
    .filter(([, c]) => c.a === node || c.b === node)
    .map(([id, connection]) => {
      const there = connection.a === node
      const way = there ? 'there' : 'back'
      return {
        id, connection, to: there ? connection.b : connection.a, DL: there ? connection.DL : connection.backDL,
        events: Object.values(connection.events).filter((e) => e.way === 'both' || e.way === way),
      }
    })
}

// Everyone in the party, on the roster or sent to a fight.
export function getPartyMembers(state: CampaignState, partyId: string): string[] {
  return Object.keys(state.partyOf).filter((id) => state.partyOf[id] === partyId)
}

// Who in the party is here to play out the time that passes: on the roster,
// alive, and not sent to a fight during it.
export function getPartyPlayers(state: CampaignState, partyId: string): string[] {
  return getPartyMembers(state, partyId).filter((id) => {
    const c = state.characters[id]
    return c && !isDead(c) && !state.out.includes(id)
  })
}

// Party members who are in a fight right now, off the roster.
export function getAway(state: CampaignState): string[] {
  return Object.keys(state.partyOf).filter((id) => !state.characters[id])
}
