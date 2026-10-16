import type { At, CampaignState, CampaignUpdater, EntryKind, MapUpdater, Party, Sequence } from '../types'
import { CrawlMapSchema, PartySchema } from '../types'
import { getPartyMembers, getPlace, isSamePlace } from '../rules/place'
import { getEmptiedParties, getPartyMoveBar, nextPartyName } from '../rules/parties'
import { without } from '../../utils'
import { nameByParty } from './names'
import { record } from './journal'

export const withParty = (partyId: string, update: (p: Party) => Party): CampaignUpdater =>
  (state) => (state.parties[partyId] ? { ...state, parties: { ...state.parties, [partyId]: update(state.parties[partyId]) } } : state)

// A new party in the campaign, with nobody in it yet, where and when `from`
// says, in play and in the sequence it is and seeing by its light, called
// `name` or the next free party name; without `from`, outside time, out of
// play and exploring.
export function addParty(partyId: string, from?: Party, name?: string): CampaignUpdater {
  return (state) => ({
    ...state,
    parties: { ...state.parties, [partyId]: PartySchema.parse({ name: name || nextPartyName(state.parties), exposure: from?.exposure, lit: from?.lit, at: from?.at, clock: from?.clock, active: from?.active, sequence: from?.sequence }) },
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
// in time (`getPartyMoveBar`), and is named by it (`nameByParty`).
export function moveToParty(id: string, partyId: string): CampaignUpdater {
  return (state) => {
    if (!(id in state.characters) || getPartyMoveBar(state, id, partyId)) return state
    return nameByParty([id])(dropLeft({ ...state, partyOf: { ...state.partyOf, [id]: partyId } }, [state.partyOf[id]]))
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

// The character leaves their party for none, and so is outside time, and
// unnamed, until they join one on a timeline.
export function leaveParty(id: string): CampaignUpdater {
  return (state) => {
    if (!(id in state.characters) || !(id in state.partyOf)) return state
    const { [id]: left, ...partyOf } = state.partyOf
    return nameByParty([id])(dropLeft({ ...state, partyOf }, [left]))
  }
}

// Puts the character in the party: the one they were in if it is still
// there, otherwise the party of whoever is selected, the first party, or a
// new one, and is named by it (`nameByParty`).
export function joinParty(id: string, newPartyId: () => string): CampaignUpdater {
  return (state) => {
    if (state.parties[state.partyOf[id]]) return nameByParty([id])(state)
    const active = state.activeCharacterId ? state.partyOf[state.activeCharacterId] : undefined
    const existing = (active && state.parties[active] ? active : undefined) ?? Object.keys(state.parties)[0]
    const partyId = existing ?? newPartyId()
    const opened = existing ? state : addParty(partyId)(state)
    return nameByParty([id])({ ...opened, partyOf: { ...opened.partyOf, [id]: partyId } })
  }
}

// Brings every member of one party into another on the same node, where
// they are together, at the same time and in the same sequence: a party
// outside time joins the other's timeline, but two timelines must be synced
// first. Whoever comes is named by the party they join (`nameByParty`).
export function mergeParties(fromId: string, intoId: string): CampaignUpdater {
  return (state) => {
    if (fromId === intoId || !state.parties[fromId] || !state.parties[intoId]) return state
    if (!isSamePlace(state.parties[fromId], state.parties[intoId])) return state
    if (state.parties[fromId].sequence !== state.parties[intoId].sequence) return state
    if (state.parties[fromId].clock !== null && state.parties[fromId].clock !== state.parties[intoId].clock) return state
    const moved = getPartyMembers(state, fromId)
    const { [fromId]: _gone, ...parties } = state.parties
    return nameByParty(moved)({ ...state, parties, partyOf: { ...state.partyOf, ...Object.fromEntries(moved.map((id) => [id, intoId])) } })
  }
}

// How the journal records a party going over to each sequence.
const ENTERED: Record<Sequence, { kind: EntryKind; title: string }> = {
  exploration: { kind: 'et', title: 'back to exploring' },
  downtime: { kind: 'days', title: 'into downtime' },
}

// The party goes over to another sequence of play, as its journal records.
// Each sequence decides when a party may leave it.
export function setPartySequence(partyId: string, sequence: Sequence): CampaignUpdater {
  return (state) => {
    const party = state.parties[partyId]
    if (!party || party.sequence === sequence) return state
    return record({ ...ENTERED[sequence], party: partyId })(withParty(partyId, (p) => ({ ...p, sequence }))(state))
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

// The table puts the party on a node of one of the campaign's maps, or
// takes it off the map with null.
export function setPartyPlace(partyId: string, at: At | null): CampaignUpdater {
  return (state) => (at && !getPlace(state, { at }) ? state : withParty(partyId, (p) => ({ ...p, at }))(state))
}

// A map from the catalog joins the campaign as a copy of its own, under
// `mapId`: what play changes on it never reaches the catalog's. Nothing
// joins for no map.
export function addMap(mapId: string, raw: unknown): CampaignUpdater {
  return (state) => (raw === undefined || state.maps[mapId] ? state : { ...state, maps: { ...state.maps, [mapId]: CrawlMapSchema.parse(raw) } })
}

// One of the campaign's maps changed as the map editor changes a map; a
// change that would leave a party on a node no longer there is refused.
export function updateCampaignMap(mapId: string, change: MapUpdater): CampaignUpdater {
  return (state) => {
    const map = state.maps[mapId]
    if (!map) return state
    const next = { ...state, maps: { ...state.maps, [mapId]: change(map) } }
    return Object.values(state.parties).some((p) => getPlace(state, p) && !getPlace(next, p)) ? state : next
  }
}

// The map leaves the campaign; the parties on it are off the map.
export function removeMap(mapId: string): CampaignUpdater {
  return (state) => {
    if (!state.maps[mapId]) return state
    const parties = Object.fromEntries(Object.entries(state.parties).map(([pid, p]) => [pid, p.at?.map === mapId ? { ...p, at: null } : p]))
    return { ...state, maps: without(state.maps, mapId), parties }
  }
}
