import type { CampaignState, EventType, TerrainTag } from '../../campaign/types'
import { TREAT_COUNT, getETMedicine, getETTreatBar, getETTreatTest, getUnsetWounds, isETMedicine, type ETMedicineKey } from '../rules/medicine'
import { ABILITIES } from '../../abilities'
import { getConsume, getDosesLeft } from '../../item/rules/consumables'
import { getConsumeBar } from '../../item/rules/doses'
import type { Camp, CastPlan, CastResult, Decision, Exploring, ExplorationState, GroupKind, GroupResult, TestRoll } from '../types'
import type { RollMode } from '../../play/dice'
import { describeOutcome, describeRoll } from '../../play/test'
import { perPair } from '../../perState'
import { getRosterName } from '../../campaign/rules/roster'
import { getPlaceKey } from '../../campaign/projections/maps'
import { getConnectionsFrom, getExposure, getPartyMembers, getPlace, getTerrainWear, isSamePlace } from '../../campaign/rules/place'
import {
  canRestHeal, getCamp, getDecisionsCalled, getExhaustionTest, getExplorationAction, getExplorationBar, getGroups,
  getGroupTest, getLocationKnowledge, getMapDL, getNightDL, getRestExposure, getWear, hasWood,
} from '../rules/exploration'
import { getRestHealing, getRestRecovery } from '../../character/rules/recovery'
import { getChargeTargets } from '../../character/rules/spells'
import { getCarriedItems } from '../../item/rules/items'
import { SPELLS, isSpellKey } from '../../spells'
import {
  entersTargetDL, getAimedHeal, getLimbOptions, needsLimb, getETCastBar, getETCastCount, getETCastExhaustion, getETCastTargets, getETCastTest, getETSpells, isEnhanceable,
} from '../rules/casting'

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
  // the node the party is on, or null off the map, and its key among the
  // node options ('' off the map)
  place: PlaceView | null
  placeKey: string
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
  dayETs: number
  parties: PartyView[]
  decisions: DecisionView[]
  // what the last ET came to, a line each
  lastET: string[]
}

const nameOf = getRosterName

// What the character spends the coming ET on, by name.
function planOf(t: Exploring, partyId: string, id: string): string {
  const group = Object.values(getGroups(t, partyId)).find((g) => g.members.includes(id))
  if (group) return group.kind
  const cast = t.exploration.casts[id]
  if (cast) return `cast ${isSpellKey(cast.key) ? SPELLS[cast.key].name : cast.key}`
  return t.exploration.resting.includes(id) ? 'rest' : 'idle'
}

// survival.tex "Exploration", "Making camp", "Point crawl" — every party,
// where it is, who is in it and what they plan, its groups and the tests
// they will make, and its camp; the decisions the coming ET waits on and
// what the last ET's groups came to.
const partiesView = perPair(({ a: state, b: exploration }: { a: CampaignState; b: ExplorationState }): PartiesView => {
  const t: Exploring = { campaign: state, exploration }
  return {
  dayETs: state.dayETs,
  parties: Object.entries(state.parties).map(([partyId, party]) => {
    const place = getPlace(state, party)
    return {
      id: partyId,
      name: party.name,
      placeKey: getPlaceKey(party.at),
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
      paths: place ? getConnectionsFrom(place).map((p) => ({ id: p.id, name: p.toName, DL: p.DL })) : [],
      others: Object.entries(state.parties).filter(([other, p]) => other !== partyId && isSamePlace(p, party)).map(([id, p]) => ({ id, name: p.name })),
    }
  }),
  decisions: getDecisionsCalled(t).map((id) => ({ id, name: nameOf(state, id), decision: exploration.opening?.decisions[id] ?? null })),
  lastET: getETResultLines(exploration.results, exploration.castResults, true),
  }
})

export const getPartiesView = (t: Exploring): PartiesView => partiesView(t.campaign, t.exploration)

const partiesDigest = perPair(({ a, b }: { a: CampaignState; b: ExplorationState }) => JSON.stringify(partiesView(a, b)))

// Everything the parties display, as one string to gate their render on.
export const getPartiesDigest = (t: Exploring): string => partiesDigest(t.campaign, t.exploration)

// What a plan would do to the character over the ET, as changes to IL and
// exhaustion; `idle` is set on a rest that has no healing left today.
export type PlanOption = { plan: { group: string } | 'rest' | 'cast' | null; label: string; IL: number; exhaustion: number; hunger: number; thirst: number; idle: boolean; selected: boolean }

// spells.tex "Casting spells": the spells the character can cast over the
// ET, and, once one is planned, what the table has to name for it — whom
// it is aimed at, the wound or lost part a heal goes on, the food it is
// cast into, the DL of the test it leaves — and its test and price.
export type CastPanel = {
  spells: { key: string; name: string; reason: string | null }[]
  // the spell a new cast plan starts with: the first that can be cast
  ready: string | null
  plan: {
    key: string
    skill: number | null
    DL: number | null
    exhaustion: number
    count: number
    targets: { id: string; name: string; selected: boolean }[]
    // the wounds of the first target a heal may go on instead of the IL
    wounds: { index: number; label: string }[] | null
    wound: number | null
    // the severed limbs at hand that fit a part the first target lost
    limbs: { id: string; name: string }[] | null
    // the food at hand a spell charged into food may go into
    foods: { id: string; name: string }[] | null
    item: string
    enteredDL: number | null
    enhance: number | null
    effortless: boolean
    // a medicine ability rather than a spell: the wound is named, never the
    // IL, the DL entered is the medic's own, and nothing is effortless
    medicine: boolean
  } | null
}

export type ExplorationPanel = {
  bar: string | null
  options: PlanOption[]
  cast: CastPanel
  // the DL of the Will test the ET will open with, if exhaustion calls for one
  willDL: number | null
  lastRoll: TestRoll | null
  potion: number
  // the food the character carries, a portion of each to eat
  foods: { id: string; name: string; amount: number; nutrition: number; charged: boolean }[]
  // gear.tex "Potions and Medicine": what the character carries a dose of
  // to take, the doses left and why one cannot be taken now
  medicines: { id: string; name: string; doses: number; bar: string | null }[]
}

// survival.tex "Exhaustion", "Rest", "Wear" — what each plan for the coming
// ET would do to the character where their party is, and why none can be
// made.
export function getExplorationPanel(t: Exploring, id: string | null): ExplorationPanel {
  const state = t.campaign
  const c = id ? state.characters[id] : undefined
  const party = id ? state.parties[state.partyOf[id]] : undefined
  if (!id || !c || !party) return { bar: 'not with a party', options: [], cast: { spells: [], ready: null, plan: null }, willDL: null, lastRoll: null, potion: 0, foods: [], medicines: [] }
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
  const castPanel = getCastPanel(t, id)
  const plannedCast = t.exploration.casts[id]
  const cast: PlanOption[] = castPanel.spells.length > 0
    ? [{ plan: 'cast', label: castPanel.spells.every((s) => isETMedicine(s.key)) ? 'treat' : 'cast', IL: 0, exhaustion: 1 + (castPanel.plan?.exhaustion ?? 0), hunger: 0, thirst: 0, idle: false, selected: !!plannedCast }]
    : []
  return {
    bar: getExplorationBar(state, id),
    options: [...groups, ...cast, rest, idle].map(worn),
    cast: castPanel,
    willDL: getExhaustionTest(c)?.DL ?? null,
    lastRoll: t.exploration.exhaustionRolls[id] ?? null,
    potion: c.injuries.potion,
    foods: getCarriedItems(c).flatMap((i) => (i.food === null ? [] : [{ id: i.id, name: i.name, amount: i.amount, nutrition: i.food, charged: i.charge !== null }])),
    medicines: getCarriedItems(c).flatMap((i) => (getConsume(i) ? [{ id: i.id, name: i.name, doses: getDosesLeft(i), bar: getConsumeBar(c, i) }] : [])),
  }
}

// abilities.tex "Bone Setting": the medic's test, who it is used on and the
// wound set (one not set yet).
function getTreatPlanPanel(t: Exploring, id: string, plan: CastPlan, key: ETMedicineKey): NonNullable<CastPanel['plan']> {
  const state = t.campaign
  const c = state.characters[id]
  const reachable = getETCastTargets(state, id)
  const first = plan.targets[0] ? state.characters[plan.targets[0]] : undefined
  const test = getETTreatTest(c, key)
  return {
    key,
    skill: test.skill,
    DL: test.DL,
    exhaustion: 0,
    count: TREAT_COUNT,
    targets: reachable.map((target) => ({ id: target, name: nameOf(state, target), selected: plan.targets.includes(target) })),
    wounds: key === 'bone-setting' && first
      ? getUnsetWounds(first).map((index) => { const w = first.injuries.wounds[index]; return { index, label: `${w.name} (${first.body.find((p) => p.id === w.part)?.name ?? w.part}, ${w.IL} IL)` } })
      : null,
    wound: plan.wound,
    limbs: null,
    foods: null,
    item: plan.item,
    enteredDL: null,
    enhance: null,
    effortless: false,
    medicine: true,
  }
}

function getCastPanel(t: Exploring, id: string): CastPanel {
  const state = t.campaign
  const c = state.characters[id]
  const spells = [
    ...getETSpells(c).map((key) => ({ key, name: SPELLS[key].name, reason: getETCastBar(c, key) })),
    ...getETMedicine(c).map((key) => ({ key, name: ABILITIES[key].name, reason: getETTreatBar(c, key) })),
  ]
  const ready = spells.find((s) => s.reason === null)?.key ?? null
  const plan = t.exploration.casts[id]
  if (plan && isETMedicine(plan.key)) return { spells, ready, plan: getTreatPlanPanel(t, id, plan, plan.key) }
  if (!plan || !isSpellKey(plan.key)) return { spells, ready, plan: null }
  const key = plan.key
  const heal = getAimedHeal(key)
  const first = plan.targets[0] ? state.characters[plan.targets[0]] : undefined
  const test = getETCastTest(c, key)
  return {
    spells,
    ready,
    plan: {
      key,
      skill: test?.skill ?? null,
      DL: test?.DL ?? null,
      exhaustion: getETCastExhaustion(key, false),
      count: getETCastCount(key),
      targets: getETCastTargets(state, id).map((target) => ({ id: target, name: nameOf(state, target), selected: plan.targets.includes(target) })),
      wounds: heal?.of === 'injury' && first
        ? first.injuries.wounds.map((w, index) => ({ index, label: `${w.name} (${first.body.find((p) => p.id === w.part)?.name ?? w.part}, ${w.IL} IL)` }))
        : null,
      wound: plan.wound,
      limbs: needsLimb(key) ? getLimbOptions(c, first).map((i) => ({ id: i.id, name: i.name })) : null,
      foods: SPELLS[key].chargeInto === 'food' ? getChargeTargets(c, key, null).map((i) => ({ id: i.id, name: i.name })) : null,
      item: plan.item,
      enteredDL: entersTargetDL(c, key) ? plan.DL : null,
      enhance: isEnhanceable(key) ? plan.enhance : null,
      effortless: plan.effortless,
      medicine: false,
    },
  }
}

// What an ET's groups and casts came to, a line each and one indented for
// each event met and each test made against a cast; `named` puts the party
// first, for an ET read across parties.
export function getETResultLines(results: GroupResult[], castResults: CastResult[], named = false): string[] {
  const of = (party: string) => (named ? `${party} · ` : '')
  return [
    ...results.flatMap((r) => [
      `${of(r.party)}${r.kind} (${r.members.join(', ')})${describeOutcome(r.roll, r.note)}`,
      ...r.events.map((e) => `  ${e.name} vs DL ${e.DL}, ${e.degree}${e.outcome ? `: ${e.outcome}` : ''}`),
    ]),
    ...castResults.flatMap((r) => [
      `${of(r.party)}${r.caster} cast ${r.spell}${r.targets.length > 0 ? ` on ${r.targets.join(', ')}` : ''}${describeOutcome(r.roll, r.note)}`,
      ...r.tests.map((test) => `  ${test.name}: ${describeRoll(test.roll)}`),
    ]),
  ]
}
