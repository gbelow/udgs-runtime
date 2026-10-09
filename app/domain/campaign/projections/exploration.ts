import type { Camp, CampaignState, Decision, GroupKind, GroupResult, Light, TestRoll } from '../types'
import type { RollMode } from '../../combat/dice'
import { perState } from '../../combat/projections/perState'
import {
  canRestHeal, getDecisionsCalled, getExhaustionTest, getExplorationAction, getExplorationBar, getGroupTest, getPartyMembers,
  getRestExposure, getRestHealing, getRestRecovery, getWear,
} from '../rules/exploration'

export type MemberView = { id: string; name: string; isActive: boolean; plan: string; out: boolean }
export type GroupView = {
  id: string
  kind: GroupKind
  members: { id: string; name: string }[]
  roller: string | null
  // the roller's skill and the DL with the night added, as the test will read them
  skill: number | null
  DL: number
  enteredDL: number
  mode: RollMode
  knowledge: number
  tool: boolean
}
export type PartyView = {
  id: string
  name: string
  exposure: number
  restExposure: number
  light: Light
  camp: Camp
  members: MemberView[]
  groups: GroupView[]
  others: { id: string; name: string }[]
}
export type DecisionView = { id: string; name: string; decision: Decision | null }
export type PartiesView = { parties: PartyView[]; decisions: DecisionView[]; results: GroupResult[] }

const nameOf = (state: CampaignState, id: string) => state.characters[id]?.fightName ?? id

// What the character spends the coming ET on, by name.
function planOf(state: CampaignState, partyId: string, id: string): string {
  const group = Object.values(state.parties[partyId]?.groups ?? {}).find((g) => g.members.includes(id))
  return group ? group.kind : state.resting.includes(id) ? 'rest' : 'idle'
}

// survival.tex "Exploration", "Making camp" — every party, who is in it and
// what they plan, its groups and the tests they will make, and its camp; the
// decisions the coming ET waits on and what the last ET's groups came to.
export const getPartiesView = perState((state: CampaignState): PartiesView => ({
  parties: Object.entries(state.parties).map(([partyId, party]) => ({
    id: partyId,
    name: party.name,
    exposure: party.exposure,
    restExposure: getRestExposure(party),
    light: party.light,
    camp: party.camp,
    members: getPartyMembers(state, partyId).map((id) => ({
      id, name: nameOf(state, id), isActive: id === state.activeCharacterId, plan: planOf(state, partyId, id), out: state.out.includes(id),
    })),
    groups: Object.entries(party.groups).map(([groupId, g]) => {
      const roller = g.roller ? state.characters[g.roller] : undefined
      const test = roller ? getGroupTest(roller, g, party) : null
      return {
        id: groupId, kind: g.kind, members: g.members.map((id) => ({ id, name: nameOf(state, id) })), roller: g.roller,
        skill: test?.skill ?? null, DL: test?.DL ?? g.DL, enteredDL: g.DL, mode: g.mode, knowledge: g.knowledge, tool: g.tool,
      }
    }),
    others: Object.entries(state.parties).filter(([other]) => other !== partyId).map(([id, p]) => ({ id, name: p.name })),
  })),
  decisions: getDecisionsCalled(state).map((id) => ({ id, name: nameOf(state, id), decision: state.opening?.decisions[id] ?? null })),
  results: state.results,
}))

// Everything the parties display, as one string to gate their render on.
export const getPartiesDigest = perState((state: CampaignState) => JSON.stringify(getPartiesView(state)))

// What a plan would do to the character over the ET, as changes to IL and
// exhaustion; `idle` is set on a rest that has no healing left today.
export type PlanOption = { plan: { group: string } | 'rest' | null; label: string; IL: number; exhaustion: number; idle: boolean; selected: boolean }

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
export function getExplorationPanel(state: CampaignState, id: string | null): ExplorationPanel {
  const c = id ? state.characters[id] : undefined
  const party = id ? state.parties[state.partyOf[id]] : undefined
  if (!id || !c || !party) return { bar: 'not with a party', options: [], willDL: null, lastRoll: null, potion: 0 }
  const plan = planOf(state, state.partyOf[id], id)
  const idle: PlanOption = { plan: null, label: 'idle', IL: 0, exhaustion: 1, idle: true, selected: plan === 'idle' }
  const exposure = getRestExposure(party)
  const healing = getRestHealing(c, exposure)
  const rest: PlanOption = canRestHeal(state, id)
    ? { plan: 'rest', label: 'rest', IL: healing < 0 ? -healing : -Math.min(healing, c.injuries.injuryLevel), exhaustion: -Math.min(getRestRecovery(exposure), c.resources.exhaustion), idle: false, selected: plan === 'rest' }
    : { ...idle, plan: 'rest', label: 'rest', selected: plan === 'rest' }
  const groups = Object.entries(party.groups).map(([groupId, g], i): PlanOption => ({
    plan: { group: groupId }, label: `${g.kind} ${i + 1}`, IL: getWear(c, getExplorationAction(g.kind)), exhaustion: 1, idle: false, selected: g.members.includes(id),
  }))
  return {
    bar: getExplorationBar(state, id),
    options: [...groups, rest, idle],
    willDL: getExhaustionTest(c)?.DL ?? null,
    lastRoll: state.exhaustionRolls[id] ?? null,
    potion: c.injuries.potion,
  }
}
