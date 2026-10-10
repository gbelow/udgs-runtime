import type { CampaignState, EventType, TerrainTag } from '../../campaign/types'
import type { Camp, Decision, Exploring, ExplorationState, GroupKind, GroupResult, TestRoll } from '../types'
import type { RollMode } from '../../play/dice'
import { perPair } from '../../perState'
import { isNight } from '../../campaign/rules/clock'
import { getConnectionsFrom, getExposure, getPartyMembers, getPlace, getTerrainWear } from '../../campaign/rules/place'
import {
  canRestHeal, getCamp, getDecisionsCalled, getExhaustionTest, getExplorationAction, getExplorationBar, getGroups,
  getGroupTest, getLocationKnowledge, getMapDL, getNightDL, getRestExposure, getWear, hasWood,
} from '../rules/exploration'
import { getRestHealing, getRestRecovery } from '../../character/rules/recovery'

export type MemberView = { id: string; name: string; isActive: boolean; plan: string; out: boolean }
export type GroupView = {
  id: string
  kind: GroupKind
  members: { id: string; name: string }[]
  roller: string | null
  // the roller's skill and the DL with the night added, as the test will read them
  skill: number | null
  DL: number | null
  // whether the table enters the DL, the map setting none
  entersDL: boolean
  enteredDL: number
  mode: RollMode
  target: string | null
  seek: EventType
  tool: boolean
}
export type PlaceView = { node: string; name: string; terrain: string | null; tags: TerrainTag[] }
export type PartyView = {
  id: string
  name: string
  // the node the party is on, or null off the map
  node: string | null
  place: PlaceView | null
  exposure: number
  restExposure: number
  lit: boolean
  // whether firewood can be looked for where the party is
  wood: boolean
  nightDL: number
  knowledge: number
  camp: Camp
  members: MemberView[]
  groups: GroupView[]
  // the paths a travel can go along, and the parties it can merge with
  paths: { id: string; name: string; DL: number }[]
  others: { id: string; name: string }[]
}
export type DecisionView = { id: string; name: string; decision: Decision | null }
export type PartiesView = {
  map: { name: string; nodes: { id: string; name: string }[] } | null
  night: boolean
  dayETs: number
  parties: PartyView[]
  decisions: DecisionView[]
  results: GroupResult[]
}

const nameOf = (state: CampaignState, id: string) => state.characters[id]?.fightName ?? id
const nodeName = (state: CampaignState, id: string) => state.map?.nodes[id]?.name ?? id

// What the character spends the coming ET on, by name.
function planOf(t: Exploring, partyId: string, id: string): string {
  const group = Object.values(getGroups(t, partyId)).find((g) => g.members.includes(id))
  return group ? group.kind : t.exploration.resting.includes(id) ? 'rest' : 'idle'
}

// survival.tex "Exploration", "Making camp", "Point crawl" — every party,
// where it is, who is in it and what they plan, its groups and the tests
// they will make, and its camp; the decisions the coming ET waits on and
// what the last ET's groups came to.
const partiesView = perPair(({ a: state, b: exploration }: { a: CampaignState; b: ExplorationState }): PartiesView => {
  const t: Exploring = { campaign: state, exploration }
  return {
  map: state.map ? { name: state.map.name, nodes: Object.entries(state.map.nodes).map(([id, n]) => ({ id, name: n.name })) } : null,
  night: isNight(state.clock, state.dayETs),
  dayETs: state.dayETs,
  parties: Object.entries(state.parties).map(([partyId, party]) => {
    const place = getPlace(state, party)
    return {
      id: partyId,
      name: party.name,
      node: place?.id ?? null,
      place: place ? { node: place.id, name: place.node.name, terrain: place.terrain?.name ?? null, tags: place.terrain?.tags ?? [] } : null,
      exposure: getExposure(state, party),
      restExposure: getRestExposure(t, partyId),
      lit: party.lit,
      wood: hasWood(state, party),
      nightDL: getNightDL(state, party),
      knowledge: getLocationKnowledge(state, partyId),
      camp: getCamp(t, partyId),
      members: getPartyMembers(state, partyId).map((id) => ({
        id, name: nameOf(state, id), isActive: id === state.activeCharacterId, plan: planOf(t, partyId, id), out: state.out.includes(id),
      })),
      groups: Object.entries(getGroups(t, partyId)).map(([groupId, g]) => {
        const test = getGroupTest(state, partyId, g)
        return {
          id: groupId, kind: g.kind, members: g.members.map((id) => ({ id, name: nameOf(state, id) })), roller: g.roller,
          skill: test?.skill ?? null, DL: test?.DL ?? null, entersDL: getMapDL(state, party, g) === null, enteredDL: g.DL,
          mode: g.mode, target: g.target, seek: g.seek, tool: g.tool,
        }
      }),
      paths: place ? getConnectionsFrom(state, place.id).map((p) => ({ id: p.id, name: nodeName(state, p.to), DL: p.DL })) : [],
      others: Object.entries(state.parties).filter(([other, p]) => other !== partyId && p.node === party.node).map(([id, p]) => ({ id, name: p.name })),
    }
  }),
  decisions: getDecisionsCalled(t).map((id) => ({ id, name: nameOf(state, id), decision: exploration.opening?.decisions[id] ?? null })),
  results: exploration.results,
  }
})

export const getPartiesView = (t: Exploring): PartiesView => partiesView(t.campaign, t.exploration)

const partiesDigest = perPair(({ a, b }: { a: CampaignState; b: ExplorationState }) => JSON.stringify(partiesView(a, b)))

// Everything the parties display, as one string to gate their render on.
export const getPartiesDigest = (t: Exploring): string => partiesDigest(t.campaign, t.exploration)

// What a plan would do to the character over the ET, as changes to IL and
// exhaustion; `idle` is set on a rest that has no healing left today.
export type PlanOption = { plan: { group: string } | 'rest' | null; label: string; IL: number; exhaustion: number; hunger: number; thirst: number; idle: boolean; selected: boolean }

export type ExplorationPanel = {
  bar: string | null
  options: PlanOption[]
  // the DL of the Will test the ET will open with, if exhaustion calls for one
  willDL: number | null
  lastRoll: TestRoll | null
  potion: number
}

// survival.tex "Exhaustion", "Rest", "Wear" — what each plan for the coming
// ET would do to the character where their party is, and why none can be
// made.
export function getExplorationPanel(t: Exploring, id: string | null): ExplorationPanel {
  const state = t.campaign
  const c = id ? state.characters[id] : undefined
  const party = id ? state.parties[state.partyOf[id]] : undefined
  if (!id || !c || !party) return { bar: 'not with a party', options: [], willDL: null, lastRoll: null, potion: 0 }
  const partyId = state.partyOf[id]
  const plan = planOf(t, partyId, id)
  const idle: PlanOption = { plan: null, label: 'idle', IL: 0, exhaustion: 1, hunger: 0, thirst: 0, idle: true, selected: plan === 'idle' }
  const exposure = getRestExposure(t, partyId)
  const healing = getRestHealing(c, exposure)
  const rest: PlanOption = canRestHeal(t, id)
    ? { plan: 'rest', label: 'rest', IL: healing < 0 ? -healing : -Math.min(healing, c.injuries.injuryLevel), exhaustion: -Math.min(getRestRecovery(exposure), c.resources.exhaustion), hunger: 0, thirst: 0, idle: false, selected: plan === 'rest' }
    : { ...idle, plan: 'rest', label: 'rest', selected: plan === 'rest' }
  const groups = Object.entries(getGroups(t, partyId)).map(([groupId, g], i): PlanOption => ({
    plan: { group: groupId }, label: `${g.kind} ${i + 1}`, IL: getWear(c, getExplorationAction(g.kind)), exhaustion: 1, hunger: 0, thirst: 0, idle: false, selected: g.members.includes(id),
  }))
  // the terrain's wear, which every plan pays on top
  const wear = getTerrainWear(state, party)
  const worn = (o: PlanOption): PlanOption =>
    ({ ...o, IL: o.IL + wear.IL, exhaustion: o.exhaustion + wear.exhaustion, hunger: o.hunger + wear.hunger, thirst: o.thirst + wear.thirst })
  return {
    bar: getExplorationBar(state, id),
    options: [...groups, rest, idle].map(worn),
    willDL: getExhaustionTest(c)?.DL ?? null,
    lastRoll: t.exploration.exhaustionRolls[id] ?? null,
    potion: c.injuries.potion,
  }
}
