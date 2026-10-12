import type { CampaignState, CampaignUpdater, Party } from '../types'
import { CrawlMapSchema, PartySchema } from '../types'
import { getPartyMembers } from '../rules/place'
import { nextPartyName } from '../rules/parties'

export const withParty = (partyId: string, update: (p: Party) => Party): CampaignUpdater =>
  (state) => (state.parties[partyId] ? { ...state, parties: { ...state.parties, [partyId]: update(state.parties[partyId]) } } : state)

// A new party in the campaign, with nobody in it yet, where `from` says and
// seeing by its light, called `name` or the next free party name.
export function addParty(partyId: string, from?: Party, name?: string): CampaignUpdater {
  return (state) => ({
    ...state,
    parties: { ...state.parties, [partyId]: PartySchema.parse({ name: name || nextPartyName(state.parties), exposure: from?.exposure, lit: from?.lit, node: from?.node }) },
  })
}

// Parties nobody is in any more are gone.
export function dropEmptyParties(state: CampaignState): CampaignState {
  const parties = Object.fromEntries(Object.entries(state.parties).filter(([pid]) => getPartyMembers(state, pid).length > 0))
  return { ...state, parties }
}

// Puts the character in the party: the one they were in if it is still
// there, otherwise the party of whoever is selected, the first party, or a
// new one.
export function joinParty(id: string, newPartyId: () => string): CampaignUpdater {
  return (state) => {
    if (state.parties[state.partyOf[id]]) return state
    const active = state.activeCharacterId ? state.partyOf[state.activeCharacterId] : undefined
    const existing = (active && state.parties[active] ? active : undefined) ?? Object.keys(state.parties)[0]
    const partyId = existing ?? newPartyId()
    const opened = existing ? state : addParty(partyId)(state)
    return { ...opened, partyOf: { ...opened.partyOf, [id]: partyId } }
  }
}

// Brings every member of one party into another on the same node, where
// they are together.
export function mergeParties(fromId: string, intoId: string): CampaignUpdater {
  return (state) => {
    if (fromId === intoId || !state.parties[fromId] || !state.parties[intoId]) return state
    if (state.parties[fromId].node !== state.parties[intoId].node) return state
    const moved = getPartyMembers(state, fromId)
    const { [fromId]: _gone, ...parties } = state.parties
    return { ...state, parties, partyOf: { ...state.partyOf, ...Object.fromEntries(moved.map((id) => [id, intoId])) } }
  }
}

// survival.tex "Exposure": the table sets how rough the party's ground is
// off the map.
export function setPartyExposure(partyId: string, exposure: number): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, exposure }))
}

// survival.tex "Night and Darkness": whether the party has "a light source
// or the ability to see in the dark".
export function setPartyLit(partyId: string, lit: boolean): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, lit }))
}

// The table puts the party on a node of the map, or takes it off the map.
export function setPartyNode(partyId: string, node: string | null): CampaignUpdater {
  return (state) => {
    if (node !== null && !state.map?.nodes[node]) return state
    return withParty(partyId, (p) => ({ ...p, node }))(state)
  }
}

// The point crawl the parties play on. Parties on a node the map does not
// have are off it.
export function loadMap(raw: unknown): CampaignUpdater {
  return (state) => {
    const map = CrawlMapSchema.parse(raw)
    const parties = Object.fromEntries(Object.entries(state.parties).map(([pid, p]) =>
      [pid, p.node && !map.nodes[p.node] ? { ...p, node: null } : p]))
    return { ...state, map, parties }
  }
}

export function unloadMap(state: CampaignState): CampaignState {
  return { ...state, map: null, parties: Object.fromEntries(Object.entries(state.parties).map(([pid, p]) => [pid, { ...p, node: null }])) }
}
