import type { CampaignState, CampaignUpdater, Party } from '../types'
import { CrawlMapSchema, PartySchema } from '../types'
import { getPartyMembers } from '../rules/place'
import { getEmptiedParties, getPartyMoveBar, nextPartyName } from '../rules/parties'

export const withParty = (partyId: string, update: (p: Party) => Party): CampaignUpdater =>
  (state) => (state.parties[partyId] ? { ...state, parties: { ...state.parties, [partyId]: update(state.parties[partyId]) } } : state)

// A new party in the campaign, with nobody in it yet, where and when `from`
// says, in play if it is and seeing by its light, called `name` or the next
// free party name; without `from`, outside time and out of play.
export function addParty(partyId: string, from?: Party, name?: string): CampaignUpdater {
  return (state) => ({
    ...state,
    parties: { ...state.parties, [partyId]: PartySchema.parse({ name: name || nextPartyName(state.parties), exposure: from?.exposure, lit: from?.lit, node: from?.node, clock: from?.clock, active: from?.active }) },
  })
}

// Parties nobody is in any more are gone.
export function dropEmptyParties(state: CampaignState): CampaignState {
  const parties = Object.fromEntries(Object.entries(state.parties).filter(([pid]) => getPartyMembers(state, pid).length > 0))
  return { ...state, parties }
}

// The parties someone has just `left` are gone if nobody is in them any more.
function dropLeft(state: CampaignState, left: readonly (string | undefined)[]): CampaignState {
  const gone = getEmptiedParties(state.partyOf, left)
  return { ...state, parties: Object.fromEntries(Object.entries(state.parties).filter(([pid]) => !gone.includes(pid))) }
}

// A new party with nobody in it yet, outside time and out of play, called
// `name` or the next free party name.
export function createParty(partyId: string, name: string): CampaignUpdater {
  return (state) => (state.parties[partyId] ? state : addParty(partyId, undefined, name)(state))
}

export function renameParty(partyId: string, name: string): CampaignUpdater {
  return (state) => (name ? withParty(partyId, (p) => ({ ...p, name }))(state) : state)
}

// The character joins another party, refused when that would take them back
// in time (`getPartyMoveBar`).
export function moveToParty(id: string, partyId: string): CampaignUpdater {
  return (state) => {
    if (!(id in state.characters) || getPartyMoveBar(state, id, partyId)) return state
    return dropLeft({ ...state, partyOf: { ...state.partyOf, [id]: partyId } }, [state.partyOf[id]])
  }
}

// The character leaves for a new party of their own, where and when the one
// they left is, in play if it was.
export function splitOff(id: string, newId: () => string): CampaignUpdater {
  return (state) => {
    if (!(id in state.characters)) return state
    const partyId = newId()
    const opened = addParty(partyId, state.parties[state.partyOf[id]])(state)
    return dropLeft({ ...opened, partyOf: { ...opened.partyOf, [id]: partyId } }, [state.partyOf[id]])
  }
}

// The character leaves their party for none, and so is outside time until
// they join one on a timeline.
export function leaveParty(id: string): CampaignUpdater {
  return (state) => {
    if (!(id in state.characters) || !(id in state.partyOf)) return state
    const { [id]: left, ...partyOf } = state.partyOf
    return dropLeft({ ...state, partyOf }, [left])
  }
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
// they are together, and at the same time: a party outside time joins the
// other's timeline, but two timelines must be synced first.
export function mergeParties(fromId: string, intoId: string): CampaignUpdater {
  return (state) => {
    if (fromId === intoId || !state.parties[fromId] || !state.parties[intoId]) return state
    if (state.parties[fromId].node !== state.parties[intoId].node) return state
    if (state.parties[fromId].clock !== null && state.parties[fromId].clock !== state.parties[intoId].clock) return state
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
