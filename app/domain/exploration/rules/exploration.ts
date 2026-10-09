import type { CampaignCharacter, Degree } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CampaignState, Party } from '../../campaign/types'
import type { Camp, Exploring, Group, GroupKind } from '../types'
import { CampSchema } from '../types'
import type { Test } from '../../play/test'
import { getAwareness, getSTA } from '../../character/rules/characteristics'
import { getHealth, getWill } from '../../character/rules/skills'
import { getKnowledge } from '../../character/rules/knowledge'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { getDay, isNight } from '../../campaign/rules/clock'
import { getAway, getConnectionsFrom, getExposure, getPartyPlayers, getPlace } from '../../campaign/rules/place'

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
  const node = t.campaign.parties[partyId]?.node ?? null
  const camp = t.exploration.camps[partyId]
  return camp && camp.node === node ? camp : CampSchema.parse({ node })
}

// survival.tex "Terrain tags": "wood: allows looking for firewood"; off the
// map nothing says otherwise.
export function hasWood(state: CampaignState, party: Party): boolean {
  const terrain = getPlace(state, party)?.terrain
  return !terrain || terrain.tags.includes('wood')
}

// survival.tex "Rest": "heals IL equal to 1+(health-exposure)/2. Negative
// values work against the character."
export function getRestHealing(c: CampaignCharacter, exposure: number): number {
  return 1 + Math.floor((getHealth(c) - exposure) / 2)
}

// survival.tex "Rest": "lowers exhaustion by 3 - exposure/2 instead of
// increasing it".
export function getRestRecovery(exposure: number): number {
  return 3 - Math.floor(exposure / 2)
}

// survival.tex "Shelter": "improves the exposure for resting by 1 on a hit
// and by 2 on a crit"; "Campfire": "reduces exposure to cold and insects by
// 1", on terrain tagged with either; off the map, on any.
export function getRestExposure(t: Exploring, partyId: string): number {
  const party = t.campaign.parties[partyId]
  const camp = getCamp(t, partyId)
  const terrain = getPlace(t.campaign, party)?.terrain
  const warms = !terrain || terrain.tags.includes('cold') || terrain.tags.includes('insects')
  return Math.max(0, getExposure(t.campaign, party) - camp.shelter - (camp.fire && warms ? 1 : 0))
}

// survival.tex "Rest": "Resting only heals 3 times per day. Any further
// resting does not heal nor lower exhaustion and just counts as being idle."
const RESTS_PER_DAY = 3

// The rests that have healed the character today.
export function getRestsToday(t: Exploring, id: string): number {
  const { rests } = t.exploration
  return rests.day === getDay(t.campaign.clock) ? rests.count[id] ?? 0 : 0
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
  return isNight(state.clock, state.dayETs) ? (party.lit ? 5 : 10) : 0
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
    case 'travel': return getConnectionsFrom(state, place.id).find((p) => p.id === group.target)?.DL ?? null
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
  return Object.keys(t.campaign.parties).flatMap((partyId) =>
    Object.values(getGroups(t, partyId)).filter((g) => isAway(g.kind)).flatMap((g) => g.members.filter((id) => isForced(t, id))))
}

// Why the character cannot change their plan or eat and drink now. The ET
// loop runs on the roster; whoever is in a fight is not on it.
export function getExplorationBar(state: CampaignState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not with the party'
  if (isDead(c)) return 'dead'
  return null
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
  if (group.kind === 'travel' && place && !getConnectionsFrom(t.campaign, place.id).some((c) => c.id === group.target)) {
    return `${party.name} travel needs a destination`
  }
  return null
}

// Why the ET cannot pass now: it passes for everyone, so it waits for anyone
// in a fight, which is counted in rounds until it is over; every group needs
// its roller, and every forced rest whose group goes away needs a decision.
export function getPassBar(t: Exploring): string | null {
  const away = getAway(t.campaign)
  if (away.length > 0) return 'someone is in a fight'
  for (const partyId of Object.keys(t.campaign.parties)) {
    for (const group of Object.values(getGroups(t, partyId))) {
      const bar = getGroupBar(t, partyId, group)
      if (bar) return bar
    }
  }
  const undecided = getDecisionsCalled(t).find((id) => !t.exploration.opening?.decisions[id])
  return undecided ? `decide for ${t.campaign.characters[undecided]?.fightName ?? undecided}` : null
}
