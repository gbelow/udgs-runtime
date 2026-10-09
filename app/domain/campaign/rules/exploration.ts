import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CampaignState, Connection, CrawlNode, Group, GroupKind, Party, PathEvent, Table, Terrain } from '../types'
import type { Degree } from '../../combat/types'
import type { Test } from '../../combat/rules/test'
import { getAwareness, getSTA } from '../../character/rules/characteristics'
import { getHealth, getWill } from '../../character/rules/skills'
import { getKnowledge } from '../../character/rules/knowledge'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { isNight } from './clock'
import { getNodeTerrain } from './terrain'

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
// Searching"; "Terrain": "Terrain can have value for extra wear".
export function getWear(c: CampaignCharacter, action: ExplorationAction, terrain = 0): number {
  const stamina = Math.max(0, Math.floor((9 - getSTA(c)) / 2))
  const lame = action !== 'prepare' && hasAffliction(c, 'lame') ? 2 : 0
  return 1 + stamina + lame + terrain
}

export type Place = { id: string; node: CrawlNode; terrain: Terrain | null }

// The node of the map the party is on and what it is made of; null off the map.
export function getPlace(state: CampaignState, party: Party): Place | null {
  const node = party.node ? state.map?.nodes[party.node] : undefined
  if (!party.node || !node) return null
  return { id: party.node, node, terrain: getNodeTerrain(node) }
}

// survival.tex "Terrain": "Every terrain has a value of exposure"; off the
// map, the table enters it.
export function getExposure(state: CampaignState, party: Party): number {
  const place = getPlace(state, party)
  return place?.terrain ? place.terrain.exposure : party.exposure
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
export function getRestExposure(state: CampaignState, party: Party): number {
  const terrain = getPlace(state, party)?.terrain
  const warms = !terrain || terrain.tags.includes('cold') || terrain.tags.includes('insects')
  return Math.max(0, getExposure(state, party) - party.camp.shelter - (party.camp.fire && warms ? 1 : 0))
}

// survival.tex "Rest": "Resting only heals 3 times per day. Any further
// resting does not heal nor lower exhaustion and just counts as being idle."
const RESTS_PER_DAY = 3

export function canRestHeal(state: CampaignState, id: string): boolean {
  return (state.rests[id] ?? 0) < RESTS_PER_DAY
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

export function isForced(state: CampaignState, id: string): boolean {
  return isForcedToRest(state.opening?.rolls[id]?.degree)
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

// Everyone in the party, on the roster or sent to a fight.
export function getPartyMembers(state: CampaignState, partyId: string): string[] {
  return Object.keys(state.partyOf).filter((id) => state.partyOf[id] === partyId)
}

// Who in the party plays the coming ET: on the roster, alive, and not sent
// to a fight during it.
export function getPartyPlayers(state: CampaignState, partyId: string): string[] {
  return getPartyMembers(state, partyId).filter((id) => {
    const c = state.characters[id]
    return c && !isDead(c) && !state.out.includes(id)
  })
}

// The forced resters whose group goes away, and who must be left behind,
// stayed with or carried.
export function getDecisionsCalled(state: CampaignState): string[] {
  return Object.values(state.parties).flatMap((party) =>
    Object.values(party.groups).filter((g) => isAway(g.kind)).flatMap((g) => g.members.filter((id) => isForced(state, id))))
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
function getGroupBar(state: CampaignState, partyId: string, group: Group): string | null {
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId).filter((id) => group.members.includes(id))
  if (players.length === 0) return null
  if (!group.roller || !players.includes(group.roller)) return `${party.name} ${group.kind} needs a roller`
  if (isForced(state, group.roller)) return `${party.name} ${group.kind} needs another roller`
  const place = getPlace(state, party)
  if (group.kind === 'travel' && place && !getConnectionsFrom(state, place.id).some((c) => c.id === group.target)) {
    return `${party.name} travel needs a destination`
  }
  return null
}

// Why the ET cannot pass now: it passes for everyone, a fight is counted in
// rounds until it is over, every group needs its roller, and every forced
// rest whose group goes away needs a decision.
export function getPassBar(table: Table): string | null {
  if (Object.keys(table.fight.characters).length > 0) return 'a fight is going on'
  const state = table.campaign
  for (const [partyId, party] of Object.entries(state.parties)) {
    for (const group of Object.values(party.groups)) {
      const bar = getGroupBar(state, partyId, group)
      if (bar) return bar
    }
  }
  const undecided = getDecisionsCalled(state).find((id) => !state.opening?.decisions[id])
  return undecided ? `decide for ${state.characters[undecided]?.fightName ?? undecided}` : null
}
