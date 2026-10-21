import { getRosterName } from '../../campaign/rules/roster'
import type { CampaignCharacter, Degree } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { Ambient, CampaignState, Party, PlaceChange } from '../../campaign/types'
import type { Camp, Exploring, Group, GroupKind } from '../types'
import { CampSchema } from '../types'
import type { Test } from '../../play/test'
import { getOpenCalls } from '../../play/calls'
import { getAwareness, getSTA } from '../../character/rules/characteristics'
import { getWill } from '../../character/rules/skills'
import { getKnowledge } from '../../character/rules/knowledge'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { getClockOf, getDay, getPlayBar, getPlayingParties, getSequenceBar, getTimeBar, isNight } from '../../campaign/rules/clock'
import { changePlace, getConnectionsFrom, getExposure, getPartyMembers, getPartyPlayers, getPlace, getPlaceKey, isOutsideSettlement, isPartyAway, isSamePlace, type PlaceNow } from '../../campaign/rules/place'
import { getEvent } from '../../campaign/rules/events'
import { getStage } from './events'
import type { Actor } from '../../profiles'

// survival.tex "Exploration Action (EA)": the four camp tasks are Prepare.
export function getExplorationAction(kind: GroupKind): ExplorationAction {
  return kind === 'travel' || kind === 'search' ? kind : 'prepare'
}

// survival.tex "Exploring and traveling": travel and search take the group
// away from the rest of the party for the ET.
export function isAway(kind: GroupKind): boolean {
  return getExplorationAction(kind) !== 'prepare'
}

// survival.tex "Wear": "The basic wear is to increase IL by +1"; "STA < 8 =
// +1 IL per EA. STA < 6 = +2 IL and so on", read off the derived STA (the
// table's ruling); combat.tex "Lame": "Takes +2 IL for traveling and
// Searching".
export function getWear(c: CampaignCharacter, action: ExplorationAction): number {
  const stamina = Math.max(0, Math.floor((9 - getSTA(c)) / 2))
  const lame = action !== 'prepare' && hasAffliction(c, 'lame') ? 2 : 0
  return 1 + stamina + lame
}

// The party's groups, each with only the members still in the party.
export function getGroups(t: Exploring, partyId: string): Record<string, Group> {
  const inParty = (id: string) => t.campaign.partyOf[id] === partyId
  return Object.fromEntries(Object.entries(t.exploration.groups[partyId] ?? {}).map(([gid, g]) =>
    [gid, { ...g, members: g.members.filter(inParty), roller: g.roller && inParty(g.roller) ? g.roller : null }]))
}

// The camp where the party stands; none if it was made on another node.
export function getCamp(t: Exploring, partyId: string): Camp {
  const at = t.campaign.parties[partyId]?.at ?? null
  const camp = t.exploration.camps[partyId]
  return camp && isSamePlace(camp, { at }) ? camp : CampSchema.parse({ at })
}

// The shelter event the party's camp stands in, in the stage it is in, if
// that stage is a shelter.
export function getCampShelter(t: Exploring, partyId: string): { id: string; name: string; change: PlaceChange } | null {
  const camp = getCamp(t, partyId)
  const event = camp.in ? getPlace(t.campaign, t.campaign.parties[partyId])?.node.events[camp.in] : undefined
  const change = event ? getStage(event)?.shelter : null
  return camp.in && event && change ? { id: camp.in, name: getEvent(event).name, change } : null
}

// The ambient events of the node the party stands on, in the stage they are
// in, and whether each is happening this ET.
export type AmbientOn = Ambient & { id: string; name: string; on: boolean }
export function getAmbient(t: Exploring, partyId: string): AmbientOn[] {
  const party = t.campaign.parties[partyId]
  const place = getPlace(t.campaign, party)
  if (!place) return []
  const on = t.exploration.ambient[getPlaceKey(party.at)] ?? []
  return Object.entries(place.node.events).flatMap(([id, event]) => {
    const ambient = getStage(event)?.ambient
    return ambient ? [{ ...ambient, id, name: getEvent(event).name, on: on.includes(id) }] : []
  })
}

// survival.tex "Terrain": what the place the party stands on is like now:
// its terrain (off the map, the exposure the table enters), then the weather
// the table calls on it, then the ambient events happening on it, then what
// events met brought on it this ET, then the shelter the camp stands in,
// which keeps out what it keeps out.
export function getPlaceNow(t: Exploring, partyId: string): PlaceNow {
  const party = t.campaign.parties[partyId]
  const terrain = getPlace(t.campaign, party)?.terrain ?? null
  const key = getPlaceKey(party.at)
  const shelter = getCampShelter(t, partyId)
  const changes = [
    ...(key && t.exploration.weather[key] ? [t.exploration.weather[key]] : []),
    ...getAmbient(t, partyId).filter((a) => a.on).map((a) => a.weather),
    ...(key ? t.exploration.passing[key] ?? [] : []),
    ...(shelter ? [shelter.change] : []),
  ]
  return changes.reduce(changePlace, { exposure: getExposure(t.campaign, party), tags: terrain ? terrain.tags : null })
}

// survival.tex "Terrain tags": "wood: allows looking for firewood"; off the
// map nothing says otherwise.
export function hasWood(t: Exploring, partyId: string): boolean {
  const { tags } = getPlaceNow(t, partyId)
  return !tags || tags.includes('wood')
}

// survival.tex "Shelter": "improves the exposure for resting by 1 on a hit
// and by 2 on a crit"; "Campfire": "reduces exposure to cold and insects by
// 1", on ground tagged with either; off the map, on any.
export function getRestExposure(t: Exploring, partyId: string): number {
  const camp = getCamp(t, partyId)
  const { exposure, tags } = getPlaceNow(t, partyId)
  const warms = !tags || tags.includes('cold') || tags.includes('insects')
  return Math.max(0, exposure - camp.shelter - (camp.fire && warms ? 1 : 0))
}

// The shelters of the node the party may camp in: one a plan of the party
// found this ET (a hit or better against it), and the one it camps in.
export function getShelters(t: Exploring, partyId: string): { id: string; name: string; in: boolean }[] {
  const party = t.campaign.parties[partyId]
  const place = getPlace(t.campaign, party)
  if (!place) return []
  const camp = getCamp(t, partyId)
  const found = new Set(Object.values(t.exploration.resolved[partyId] ?? {}).flatMap((r) =>
    (r.result?.events ?? []).filter((e) => e.owner.kind === 'node' && e.owner.id === place.id && (e.degree === 'hit' || e.degree === 'critical')).map((e) => e.event)))
  return Object.entries(place.node.events)
    .filter(([id, event]) => getStage(event)?.shelter && (found.has(id) || camp.in === id))
    .map(([id, event]) => ({ id, name: getEvent(event).name, in: camp.in === id }))
}

// Whether anyone of `ids` has met the event before.
export function knowsEvent(t: Exploring, ids: string[], key: string): boolean {
  return ids.some((id) => t.exploration.known[id]?.includes(key))
}

// survival.tex "Rest": "Resting only heals 3 times per day. Any further
// resting does not heal nor lower exhaustion and just counts as being idle."
const RESTS_PER_DAY = 3

// The rests that have healed the character today.
export function getRestsToday(t: Exploring, id: string): number {
  const rests = t.exploration.rests[id]
  const clock = getClockOf(t.campaign, id)
  return rests && clock !== null && rests.day === getDay(clock) ? rests.count : 0
}

export function canRestHeal(t: Exploring, id: string): boolean {
  return getRestsToday(t, id) < RESTS_PER_DAY
}

// survival.tex "Exhaustion": "Any ET where the character starts with
// exhaustion at 12 or higher, it has to make a Will test with a DL equal to
// character's exhaustion - 10."
export function getExhaustionTest(c: CampaignCharacter): Test | null {
  const exhaustion = c.resources.exhaustion
  return exhaustion >= 12 ? { skill: getWill(c), DL: exhaustion - 10, explodes: false, scale: 'degrees' } : null
}

// survival.tex "Exhaustion": "If the character grazes or misses, it is forced
// to rest wherever it is."
export function isForcedToRest(degree: Degree | undefined): boolean {
  return degree === 'miss' || degree === 'graze'
}

export function isForced(t: Exploring, id: string): boolean {
  return isForcedToRest(t.exploration.opening?.rolls[id]?.degree)
}

// survival.tex "Night and Darkness": "If the group has a light source or the
// ability to see in the dark, the DL for travel and search is increased by
// just +5. If the group is without vision, search and travel increases by
// +10."
export function getNightDL(state: CampaignState, party: Party): number {
  return isNight(party.clock, state.dayETs) ? (party.lit ? 5 : 10) : 0
}

// survival.tex "Exploring and traveling": "the specific knowledge about the
// location", held by whoever in the party knows the terrain best.
export function getLocationKnowledge(state: CampaignState, partyId: string): number {
  const terrain = getPlace(state, state.parties[partyId])?.terrain
  if (!terrain) return 0
  return Math.max(0, ...getPartyPlayers(state, partyId).map((id) => getKnowledge(terrain.knowledge)(state.characters[id])))
}

// The DL the map sets a group's test, before night: the path travelled, the
// terrain's natural shelter DL for shelter and firewood ("Use natural
// shelter DL when searching for firewood"), and nothing for a search, which
// is read against each event. Null where the table enters it.
export function getMapDL(state: CampaignState, party: Party, group: Group): number | null {
  const place = getPlace(state, party)
  if (!place) return null
  switch (group.kind) {
    case 'travel': return getConnectionsFrom(place).find((p) => p.id === group.target)?.DL ?? null
    case 'search': return 0
    case 'shelter':
    case 'firewood': return place.terrain?.shelterDL ?? null
    default: return null
  }
}

// survival.tex "Exploration": travel and search test the Exploration skill,
// "the specific knowledge about the location + the awareness proficiency";
// "Prepare": "The skill used is 2x survival knowledge". Null without a roller.
export function getGroupTest(state: CampaignState, partyId: string, group: Group): Test | null {
  const c = group.roller ? state.characters[group.roller] : undefined
  const party = state.parties[partyId]
  if (!c || !party) return null
  const away = isAway(group.kind)
  const skill = away ? getLocationKnowledge(state, partyId) + getAwareness(c) : 2 * getKnowledge('survival')(c)
  return { skill, DL: (getMapDL(state, party, group) ?? group.DL) + (away ? getNightDL(state, party) : 0), explodes: false, scale: 'degrees' }
}

// The forced resters whose group goes away, and who must be left behind,
// stayed with or carried.
export function getDecisionsCalled(t: Exploring): string[] {
  return getPlayingParties(t.campaign, 'exploration').flatMap((partyId) =>
    Object.values(getGroups(t, partyId)).filter((g) => isAway(g.kind)).flatMap((g) => g.members.filter((id) => isForced(t, id))))
}

// Why the character cannot change their plan or eat and drink now. The ET
// loop runs on the roster; whoever is in a fight is not on it, and a party
// in downtime spends days, not ETs.
export function getExplorationBar(state: CampaignState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not with the party'
  if (isDead(c)) return 'dead'
  return getSequenceBar(state, state.partyOf[id], 'exploration')
}

// Whether the group's plan has been resolved in the ET under way.
export function isResolved(t: Exploring, partyId: string, groupId: string): boolean {
  return !!t.exploration.resolved[partyId]?.[groupId]
}

// Why the character cannot change their plan now: what keeps them from the
// ET loop, or a plan of theirs already resolved in the ET under way, which
// holds them until everyone's ET is over.
export function getPlanBar(t: Exploring, id: string): string | null {
  const bar = getExplorationBar(t.campaign, id)
  if (bar) return bar
  const partyId = t.campaign.partyOf[id]
  const spent = Object.entries(getGroups(t, partyId)).some(([groupId, g]) => g.members.includes(id) && isResolved(t, partyId, groupId))
  return spent ? 'spent this ET; waiting for the others' : null
}

// Why the party cannot leave exploration for downtime now: it is not
// exploring, an ET waits on the table, one of it is in a fight, or it is on
// the map but not in a settlement (story.tex "Downtime": a town downtime can
// be spent in).
export function getToDowntimeBar(t: Exploring, partyId: string): string | null {
  const party = t.campaign.parties[partyId]
  if (!party) return 'no such party'
  const bar = getPlayBar(t.campaign, partyId) ?? getSequenceBar(t.campaign, partyId, 'exploration')
  if (bar) return bar
  if (t.exploration.opening) return 'the ET under way must pass first'
  if (isPartyAway(t.campaign, partyId)) return 'someone is in a fight'
  return isOutsideSettlement(t.campaign, party) ? 'not in a settlement' : null
}

// Why the group cannot be gone on: "only one character rolls for it", and
// that one must be with the group and able to; on the map, a travel goes
// along a path out of the node.
function getGroupBar(t: Exploring, partyId: string, group: Group): string | null {
  const party = t.campaign.parties[partyId]
  const players = getPartyPlayers(t.campaign, partyId).filter((id) => group.members.includes(id))
  if (players.length === 0) return null
  if (!group.roller || !players.includes(group.roller)) return `${party.name} ${group.kind} needs a roller`
  if (isForced(t, group.roller)) return `${party.name} ${group.kind} needs another roller`
  const place = getPlace(t.campaign, party)
  if (group.kind === 'travel' && place && !getConnectionsFrom(place).some((c) => c.id === group.target)) {
    return `${party.name} travel needs a destination`
  }
  return null
}

// Whom setting up a group of party `partyId` acts for: whoever plays someone
// in the party, but the table for a DL, which the table enters.
export function getGroupActor(t: Exploring, partyId: string, settings: Partial<Group> = {}): Actor {
  return 'DL' in settings ? 'gm' : { anyOf: getPartyMembers(t.campaign, partyId) }
}

// Why the ET cannot pass now: time must be able to pass (`getTimeBar`), every
// group not resolved yet needs its roller, and every forced rest whose group
// goes away needs a decision.
export function getPassBar(t: Exploring): string | null {
  const bar = getTimeBar(t.campaign, 'exploration')
  if (bar) return bar
  const open = getOpenCalls(t.exploration.calls).length
  if (open > 0) return `waiting on ${open} ${open === 1 ? 'die' : 'dice'}`
  for (const partyId of getPlayingParties(t.campaign, 'exploration')) {
    for (const [groupId, group] of Object.entries(getGroups(t, partyId))) {
      const bar = isResolved(t, partyId, groupId) ? null : getGroupBar(t, partyId, group)
      if (bar) return bar
    }
  }
  return getUndecidedBar(t)
}

function getUndecidedBar(t: Exploring): string | null {
  const undecided = getDecisionsCalled(t).find((id) => !t.exploration.opening?.decisions[id])
  return undecided ? `decide for ${getRosterName(t.campaign, undecided)}` : null
}

// Why the group's plan cannot be resolved now, on its own: time must be able
// to pass, the dice called for must be in, no other plan may be waiting on
// the table, and the group must be ready to go and not resolved already.
export function getResolveBar(t: Exploring, partyId: string, groupId: string): string | null {
  const bar = getTimeBar(t.campaign, 'exploration')
  if (bar) return bar
  if (!getPlayingParties(t.campaign, 'exploration').includes(partyId)) return 'not exploring'
  const group = getGroups(t, partyId)[groupId]
  if (!group) return 'no such group'
  if (isResolved(t, partyId, groupId)) return 'resolved this ET'
  const open = getOpenCalls(t.exploration.calls).length
  if (open > 0) return `waiting on ${open} ${open === 1 ? 'die' : 'dice'}`
  const pending = t.exploration.pending
  if (pending && (pending.party !== partyId || pending.group !== groupId)) return 'another plan waits on the table'
  return getGroupBar(t, partyId, group) ?? getUndecidedBar(t)
}
