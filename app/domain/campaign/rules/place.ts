import type { At, CampaignState, Connection, CrawlMap, CrawlNode, Party, PathEvent, Terrain, Wear } from '../types'
import { WearSchema } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { getNodeTerrain } from './terrain'

export type Place = { map: CrawlMap; id: string; node: CrawlNode; terrain: Terrain | null }

// The node `at` names on the campaign's maps and what it is made of; null
// off the map, or for a node no map has.
export function getPlace(state: CampaignState, { at }: { at: At | null }): Place | null {
  const map = at ? state.maps[at.map] : undefined
  const node = at ? map?.nodes[at.node] : undefined
  return at && map && node ? { map, id: at.node, node, terrain: getNodeTerrain(node) } : null
}

// The parties standing on each node of the map, by node.
export function getPartiesOn(state: CampaignState, mapId: string): Record<string, Party[]> {
  const on: Record<string, Party[]> = {}
  for (const p of Object.values(state.parties)) if (p.at?.map === mapId) on[p.at.node] = [...(on[p.at.node] ?? []), p]
  return on
}

// Whether the two stand on the same node of the same map, or are both off
// the map.
export function isSamePlace(a: { at: At | null }, b: { at: At | null }): boolean {
  return a.at?.map === b.at?.map && a.at?.node === b.at?.node
}

// survival.tex "Terrain": "Terrain can have value for extra wear. For
// example, spending an ET in the desert without shelter always inflicts an
// extra thirst" — paid every ET by everyone on the node, whatever they do;
// a shelter is a node of its own, with its own wear.
export function getTerrainWear(state: CampaignState, party: Party): Wear {
  return getPlace(state, party)?.terrain?.wear ?? WearSchema.parse({})
}

// survival.tex "Terrain": "Every terrain has a value of exposure"; off the
// map, the table enters it.
export function getExposure(state: CampaignState, party: Party): number {
  const place = getPlace(state, party)
  return place?.terrain ? place.terrain.exposure : party.exposure
}

export type Path = { id: string; connection: Connection; to: string; toName: string; DL: number; events: (PathEvent & { id: string })[] }

// The paths out of the place, each as travelled from it: the node at the
// other end, the DL that way, and the events met going that way.
export function getConnectionsFrom({ map, id: node }: Place): Path[] {
  return Object.entries(map.connections)
    .filter(([, c]) => c.a === node || c.b === node)
    .map(([id, connection]) => {
      const there = connection.a === node
      const way = there ? 'there' : 'back'
      const to = there ? connection.b : connection.a
      return {
        id, connection, to, toName: map.nodes[to]?.name ?? to, DL: there ? connection.DL : connection.backDL,
        events: Object.entries(connection.events).filter(([, e]) => e.way === 'both' || e.way === way).map(([eventId, e]) => ({ ...e, id: eventId })),
      }
    })
}

// Everyone in the party, on the roster or sent to a fight.
export function getPartyMembers(state: CampaignState, partyId: string): string[] {
  return Object.keys(state.partyOf).filter((id) => state.partyOf[id] === partyId)
}

// Who in the party is here to play out the time that passes: on the roster,
// alive, and not in a fight.
export function getPartyPlayers(state: CampaignState, partyId: string): string[] {
  return getPartyMembers(state, partyId).filter((id) => {
    const c = state.characters[id]
    return c && !isDead(c)
  })
}

// Party members who are in a fight right now, off the roster.
export function getAway(state: CampaignState): string[] {
  return Object.keys(state.partyOf).filter((id) => !state.characters[id])
}

// Whether anyone in the party is away in a fight.
export function isPartyAway(state: CampaignState, partyId: string): boolean {
  return getPartyMembers(state, partyId).some((id) => !state.characters[id])
}

// Whether the party stands on a node of the map that is no settlement; off
// the map, the table says where it is.
export function isOutsideSettlement(state: CampaignState, { at }: { at: At | null }): boolean {
  const node = at ? state.maps[at.map]?.nodes[at.node] : undefined
  return node !== undefined && !node.settlement
}
