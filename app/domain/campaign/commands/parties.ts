import type { CampaignState, CampaignUpdater, Decision, Group, GroupKind, Light, Party } from '../types'
import { GroupSchema, PartySchema } from '../types'
import { getDecisionsCalled, getExplorationBar, getPartyMembers } from '../rules/exploration'

const withParty = (partyId: string, update: (p: Party) => Party): CampaignUpdater =>
  (state) => (state.parties[partyId] ? { ...state, parties: { ...state.parties, [partyId]: update(state.parties[partyId]) } } : state)

const withGroup = (partyId: string, groupId: string, update: (g: Group) => Group): CampaignUpdater =>
  withParty(partyId, (p) => (p.groups[groupId] ? { ...p, groups: { ...p.groups, [groupId]: update(p.groups[groupId]) } } : p))

// A party's name: the first "Party n" no party has.
function nextPartyName(state: CampaignState): string {
  const names = new Set(Object.values(state.parties).map((p) => p.name))
  let n = 1
  while (names.has(`Party ${n}`)) n++
  return `Party ${n}`
}

// A new party in the campaign, with nobody in it yet.
export function addParty(partyId: string, from?: Party): CampaignUpdater {
  return (state) => ({
    ...state,
    parties: { ...state.parties, [partyId]: PartySchema.parse({ name: nextPartyName(state), exposure: from?.exposure, light: from?.light }) },
  })
}

// Out of any group and any rest the character planned.
export function clearPlan(id: string): CampaignUpdater {
  return (state) => {
    const partyId = state.partyOf[id]
    const unplanned = { ...state, resting: state.resting.filter((r) => r !== id) }
    return partyId ? withParty(partyId, (p) => ({
      ...p,
      groups: Object.fromEntries(Object.entries(p.groups).map(([gid, g]) =>
        [gid, { ...g, members: g.members.filter((m) => m !== id), roller: g.roller === id ? null : g.roller }])),
    }))(unplanned) : unplanned
  }
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

// Brings every member of one party into another, where they are together.
// The party that is joined keeps its camp; the groups of the one that joins
// are dropped.
export function mergeParties(fromId: string, intoId: string): CampaignUpdater {
  return (state) => {
    if (fromId === intoId || !state.parties[fromId] || !state.parties[intoId]) return state
    const moved = getPartyMembers(state, fromId)
    const unplanned = moved.reduce((s, id) => clearPlan(id)(s), state)
    const { [fromId]: _gone, ...parties } = unplanned.parties
    return { ...unplanned, parties, partyOf: { ...unplanned.partyOf, ...Object.fromEntries(moved.map((id) => [id, intoId])) } }
  }
}

// survival.tex "Exposure": the table sets how rough the party's ground is.
export function setPartyExposure(partyId: string, exposure: number): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, exposure }))
}

// survival.tex "Night and Darkness": the table sets what the party sees by.
export function setPartyLight(partyId: string, light: Light): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, light }))
}

export function addGroup(partyId: string, kind: GroupKind, newId: () => string): CampaignUpdater {
  return withParty(partyId, (p) => ({ ...p, groups: { ...p.groups, [newId()]: GroupSchema.parse({ kind }) } }))
}

export function removeGroup(partyId: string, groupId: string): CampaignUpdater {
  return withParty(partyId, (p) => {
    const { [groupId]: _gone, ...groups } = p.groups
    return { ...p, groups }
  })
}

// The table's settings for the group's test.
export function setGroup(partyId: string, groupId: string, settings: Partial<Pick<Group, 'DL' | 'mode' | 'knowledge' | 'tool'>>): CampaignUpdater {
  return withGroup(partyId, groupId, (g) => ({ ...g, ...settings }))
}

// "only one character rolls for it": one of the group's members.
export function setRoller(partyId: string, groupId: string, roller: string): CampaignUpdater {
  return withGroup(partyId, groupId, (g) => (g.members.includes(roller) ? { ...g, roller } : g))
}

// The character goes with this group of their party for the coming ET,
// leaving whatever else they planned.
export function joinGroup(id: string, groupId: string): CampaignUpdater {
  return (state) => {
    const partyId = state.partyOf[id]
    if (getExplorationBar(state, id) || !state.parties[partyId]?.groups[groupId]) return state
    return withGroup(partyId, groupId, (g) => ({ ...g, members: [...g.members, id], roller: g.roller ?? id }))(clearPlan(id)(state))
  }
}

// The character rests the coming ET, or, with false, is idle.
export function setResting(id: string, resting: boolean): CampaignUpdater {
  return (state) => {
    if (getExplorationBar(state, id)) return state
    const cleared = clearPlan(id)(state)
    return resting ? { ...cleared, resting: [...cleared.resting, id] } : cleared
  }
}

// What happens to a character forced to rest while their group goes away.
export function decide(id: string, decision: Decision): CampaignUpdater {
  return (state) => {
    if (!state.opening || !getDecisionsCalled(state).includes(id)) return state
    return { ...state, opening: { ...state.opening, decisions: { ...state.opening.decisions, [id]: decision } } }
  }
}
