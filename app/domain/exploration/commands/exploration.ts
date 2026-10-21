import { getRosterName } from '../../campaign/rules/roster'
import type { CampaignCharacter, Degree, Item, SlotKind } from '../../types'
import type { At, CampaignState, CampaignUpdater, CrawlEvent, EventOwner, EventStage, PlaceChange, TerrainTag, Wear } from '../../campaign/types'
import { PlaceChangeSchema } from '../../campaign/types'
import type { Camp, CastPlan, CastResult, Exploring, ExplorationUpdater, Group, GroupKind, GroupResult, Meeting, Met, Opening, Resolved, StayResult, TestRoll } from '../types'
import { CampSchema } from '../types'
import { rollPercent, type Dice, type DieSource } from '../../play/dice'
import { getDegree, type Test } from '../../play/test'
import { answerCall, getOpenCalls, makeCaller, toCallRoll, type CallResult, type CallSpec, type Caller, type Throw } from '../../play/calls'
import { getETResultLines } from '../projections/exploration'
import { addExhaustion, addIL, heal } from '../../character/commands/heal'
import {
  canRestHeal, getCamp, getExhaustionTest, getExplorationAction, getExplorationBar, getGroups, getGroupTest, getNightDL,
  getDecisionsCalled, getPassBar, getPlaceNow, getResolveBar, getRestExposure, getRestsToday, getShelters, getToDowntimeBar, getWear, hasWood, isAway, isForcedToRest, isResolved, knowsEvent,
} from '../rules/exploration'
import { getRestHealing, getRestRecovery } from '../../character/rules/recovery'
import { BLANK_WEIGHT, asksTable, drawWeighted, getEventDL, getEventWeight, getStage, isFound } from '../rules/events'
import { getDay, getPlayingParties } from '../../campaign/rules/clock'
import { getEvent } from '../../campaign/rules/events'
import { getEventKey, getPlaceKey, type PlaceNow } from '../../campaign/rules/place'
import { getConnectionsFrom, getPartyMembers, getPartyPlayers, getPlace, getTerrainWear, type Path, type Place } from '../../campaign/rules/place'
import { passETs } from '../../campaign/commands/clock'
import { record } from '../../campaign/commands/journal'
import { without } from '../../utils'
import { addParty, setPartySequence } from '../../campaign/commands/parties'
import { updateRosterCharacter } from '../../campaign/commands/roster'
import { deliverAll } from '../../character/commands/deliver'
import { takeDose } from '../../character/commands/consume'
import { chargeItem, consumeItem } from '../../item/commands/hands'
import { canFitItem, findCarriedItem, getContainer } from '../../item/rules/containers'
import { addItemToContainer } from '../../item/commands/items'
import { getCatalogItem } from '../../item/rules/items'
import { payCost } from '../../character/commands/cost'
import { skillLenses } from '../../character/lenses'
import { produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey } from '../../spells'
import { BONE_SETTING_PER_DAY, getETTreatBar, getETTreatPlanBar, getETTreatTest, isETMedicine, isETSpared, type ETMedicineKey } from '../rules/medicine'
import { setWound } from '../../character/commands/wounds'
import { ABILITIES } from '../../abilities'
import { buyETImprovements, hasPlannedLimb, needsLimb, getETCastBar, getETCastExhaustion, getETCastTargets, getETCastTest, getETRestBonus, getETTargetTest, produceETCast } from '../rules/casting'

// A test the ET makes: what its die came to, or null while the table has yet
// to roll it.
type Tester = (spec: CallSpec) => CallResult | null

const onCharacter = (id: string, update: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater =>
  (state) => (getExplorationBar(state, id) ? state : updateRosterCharacter(id, update)(state))

// survival.tex "Hunger": "Each portion eaten recovers a number of hunger
// points defined in the portion itself."
export function eat(id: string, nutrition: number): CampaignUpdater {
  return onCharacter(id, (c) =>
    ({ ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, nutrition)) } }))
}

// survival.tex "Hunger": a portion of food the character carries, eaten: one
// unit of its stack gone, its nutrition off their hunger, and what a spell
// charged into it released into them (spells.tex "Healing Food").
export function eatFood(id: string, itemId: string): CampaignUpdater {
  return onCharacter(id, (c) => {
    const item = findCarriedItem(c, itemId)?.item
    if (!item || item.food === null) return c
    const fed = { ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, item.food)) } }
    const released = (item.charge?.effects ?? []).map((e) => produceSpellEffect(c, e))
    return deliverAll(released)(consumeItem(itemId)(fed))
  })
}

// gear.tex "Potions and Medicine": a dose of something the character
// carries, taken outside a fight, where it takes no action.
export function takeItem(id: string, itemId: string): CampaignUpdater {
  return onCharacter(id, takeDose(itemId))
}

// survival.tex "Thirst": "Every portion of water recovers 1 thirst".
export function drink(id: string): CampaignUpdater {
  return onCharacter(id, (c) =>
    ({ ...c, resources: { ...c.resources, thirst: Math.max(0, c.resources.thirst - 1) } }))
}

// survival.tex "Events": an item off the party's found pile, put where the
// character has room for it; refused for one not in that party or with no
// room there.
export function takeFromPile(partyId: string, itemId: string, id: string, containerKey: string, slot: SlotKind): ExplorationUpdater {
  return (t) => {
    const item = t.exploration.piles[partyId]?.find((i) => i.id === itemId)
    const c = t.campaign.characters[id]
    const container = c && getContainer(c, containerKey)
    if (!item || t.campaign.partyOf[id] !== partyId || getExplorationBar(t.campaign, id) || !container || !canFitItem(container, slot, item)) return t
    return {
      campaign: updateRosterCharacter(id, addItemToContainer(containerKey, slot, item))(t.campaign),
      exploration: { ...t.exploration, piles: { ...t.exploration.piles, [partyId]: t.exploration.piles[partyId].filter((i) => i.id !== itemId) } },
    }
  }
}

// survival.tex "Events": the party's camp moved into a shelter of its node
// that a plan of it found this ET, at no cost in time, or, with null, back
// out into the open.
export function campIn(partyId: string, eventId: string | null): ExplorationUpdater {
  return (t) => {
    if (eventId !== null && !getShelters(t, partyId).some((s) => s.id === eventId)) return t
    return { ...t, exploration: { ...t.exploration, camps: { ...t.exploration.camps, [partyId]: { ...getCamp(t, partyId), in: eventId } } } }
  }
}

// The weather the table calls on the node the party stands on, kept there
// until it changes it; a tag toggled is added, or kept out, against what the
// place is like now.
export function toggleWeatherTag(partyId: string, tag: TerrainTag): ExplorationUpdater {
  return withWeather(partyId, (weather, now) => (now.tags?.includes(tag)
    ? { ...weather, add: weather.add.filter((other) => other !== tag), remove: [...new Set([...weather.remove, tag])] }
    : { ...weather, remove: weather.remove.filter((other) => other !== tag), add: [...new Set([...weather.add, tag])] }))
}

export function setWeatherRaise(partyId: string, raise: number): ExplorationUpdater {
  return withWeather(partyId, (weather) => ({ ...weather, raise }))
}

export function clearWeather(partyId: string): ExplorationUpdater {
  return (t) => {
    const key = getPlaceKey(t.campaign.parties[partyId]?.at ?? null)
    return key ? { ...t, exploration: { ...t.exploration, weather: without(t.exploration.weather, key) } } : t
  }
}

const withWeather = (partyId: string, update: (weather: PlaceChange, now: PlaceNow) => PlaceChange): ExplorationUpdater =>
  (t) => {
    const key = getPlaceKey(t.campaign.parties[partyId]?.at ?? null)
    if (!key) return t
    const weather = update(t.exploration.weather[key] ?? PlaceChangeSchema.parse({}), getPlaceNow(t, partyId))
    return { ...t, exploration: { ...t.exploration, weather: { ...t.exploration.weather, [key]: weather } } }
  }

// What the table does to the DL of the test an event met asks, for what
// those meeting it do about it (a rope thrown down a climb).
export function adjustMet(index: number, adjust: number): ExplorationUpdater {
  return (t) => {
    const pending = t.exploration.pending
    if (!pending?.meeting.events[index]) return t
    const events = pending.meeting.events.map((e, i) => (i === index ? { ...e, adjust } : e))
    return { ...t, exploration: { ...t.exploration, pending: { ...pending, meeting: { ...pending.meeting, events } } } }
  }
}

// survival.tex "Healing Potions": "heal IL in the course of an ET. Healing
// through potions does not increase hunger and thirst. Any healing that is
// not used during the ET is lost."
function spendPotion(c: CampaignCharacter): CampaignCharacter {
  const healed = Math.min(c.injuries.potion, c.injuries.injuryLevel)
  return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel - healed, potion: 0 } }
}

// survival.tex "Rest": exhaustion lowers and IL heals, by negative amounts on
// ground rough enough to work against the character.
function rest(c: CampaignCharacter, exposure: number, bonus: number): CampaignCharacter {
  const recovered = addExhaustion(-getRestRecovery(exposure))(c)
  const healing = getRestHealing(c, exposure, bonus)
  return healing < 0 ? addIL(-healing)(recovered) : heal(Math.min(healing, recovered.injuries.injuryLevel))(recovered)
}

// The party leaves exploration for downtime, refused as `getToDowntimeBar`
// says; its groups, its camp and what its members planned for the coming ET
// are left behind.
export function toDowntime(partyId: string): ExplorationUpdater {
  return (t) => {
    if (getToDowntimeBar(t, partyId)) return t
    const members = getPartyMembers(t.campaign, partyId)
    const casts = Object.fromEntries(Object.entries(t.exploration.casts).filter(([id]) => !members.includes(id)))
    return {
      campaign: setPartySequence(partyId, 'downtime')(t.campaign),
      exploration: {
        ...t.exploration, groups: without(t.exploration.groups, partyId), camps: without(t.exploration.camps, partyId), casts,
        resting: t.exploration.resting.filter((id) => !members.includes(id)),
      },
    }
  }
}

// survival.tex "Exhaustion": the Will tests the coming ET opens with, made
// once by everyone who plays it. Each party's camp as the ET found it is kept
// to read its tasks against; what was under way from the last ET is the
// tasks' to finish, not the camp's any more.
function openET(t: Exploring, test: Tester): Exploring {
  const state = t.campaign
  const rolls: Record<string, TestRoll> = {}
  const parties = getPlayingParties(state, 'exploration')
  for (const partyId of parties) {
    for (const id of getPartyPlayers(state, partyId)) {
      const will = getExhaustionTest(state.characters[id])
      const result = will ? test({ id: `will:${id}`, roller: id, label: 'Will against exhaustion', test: will }) : null
      if (result) rolls[id] = toCallRoll(result)
    }
  }
  const start = Object.fromEntries(parties.map((partyId) => [partyId, getCamp(t, partyId)]))
  const camps = { ...t.exploration.camps, ...Object.fromEntries(parties.map((partyId) => [partyId, { ...start[partyId], progress: [] }])) }
  return { ...t, exploration: { ...t.exploration, camps, opening: { rolls, decisions: {}, start } } }
}

const won = (degree: Degree) => degree === 'hit' || degree === 'critical'

// survival.tex "Making camp": what a camp task's degree leaves the camp. A
// graze on firewood or the fire is progress the same task finishes the ET
// after ("spend double the time", "spend 2 ETs to succeed").
function landTask(kind: GroupKind, degree: Degree, camp: Camp): Camp {
  switch (kind) {
    case 'shelter': return degree === 'critical' ? { ...camp, shelter: 2 } : degree === 'hit' ? { ...camp, shelter: Math.max(camp.shelter, 1) } : camp
    case 'firewood':
    case 'fire': {
      if (degree === 'graze') return { ...camp, progress: [...camp.progress, kind] }
      if (!won(degree)) return camp
      // "The firewood is enough for 3 ETs."
      return kind === 'firewood' ? { ...camp, firewood: camp.firewood + 3 } : { ...camp, fire: true }
    }
    default: return camp
  }
}

// Where a group that went ends the ET: at a node of the map, or null off
// it. A group with no `moves` is where it started.
type Outcome = Meeting & { task: Degree | null }

// An event of a node or a path in the stage it is in; one left with no
// stage is not there to be met.
type Listed = { id: string; event: CrawlEvent; stage: EventStage }
const listed = (events: [string, CrawlEvent][]): Listed[] =>
  events.flatMap(([id, event]) => {
    const stage = getStage(event)
    return stage ? [{ id, event, stage }] : []
  })

// survival.tex "Events": each event met resolves itself, by the degree the
// group's score comes to against the stage it is in.
type Meet = (owner: EventOwner) => (l: Listed) => Met
const meeting = (score: number, night: number, known: (owner: EventOwner, id: string) => boolean): Meet => (owner) => ({ id, event, stage }) => {
  const DL = getEventDL(stage, night, known(owner, id))
  const degree = getDegree(score, DL)
  return { owner, event: id, name: getEvent(event).name, DL, degree, outcome: stage.outcomes[degree], adjust: 0, tests: [] }
}

type Drawn = { path: Path } | { event: Listed } | null

// survival.tex "Travel": "A crit or hit means that no one got lost";
// "Grazes and misses": a random event of the node, the path that was
// looked for among them, and "If the exploration test result is lower than
// 0, also add paths to other nodes". The group ends where what was drawn
// is: drawing a path, or an event on it, travels it. "Connection events:
// happen when traveling from one node to another", each met by the score;
// one that stops the group keeps it where it set out from.
function travel(from: At, place: Place, group: Group, roll: TestRoll, meet: Meet, dice: Dice): Meeting {
  const paths = getConnectionsFrom(place)
  const chosen = paths.find((p) => p.id === group.target)
  if (!chosen) return { roll, note: 'no path', moves: null, events: [] }
  const onPath = (path: Path) => listed(path.events.map((e) => [e.id, e]))
  const along = (path: Path, note: string): Meeting => {
    const events = onPath(path).map(meet({ kind: 'connection', id: path.id }))
    const stop = events.find((e) => e.outcome.stop)
    return stop
      ? { roll, note: `stopped by ${stop.name} on the way to ${path.toName}`, moves: null, events }
      : { roll, note, moves: { at: { map: from.map, node: path.to } }, events }
  }
  if (won(roll.degree)) return along(chosen, `arrived at ${chosen.toName}`)
  const weighted = (DL: number, item: Drawn) => ({ weight: getEventWeight(DL), item })
  const drawn = drawWeighted<Drawn>([
    ...listed(Object.entries(place.node.events)).map((l) => weighted(l.stage.DL, { event: l })),
    weighted(chosen.DL, { path: chosen }),
    ...onPath(chosen).map((l) => weighted(l.stage.DL, { path: chosen })),
    ...(roll.score < 0 ? paths.filter((p) => p !== chosen).map((path) => weighted(path.DL, { path })) : []),
    { weight: BLANK_WEIGHT, item: null },
  ], rollPercent(dice))
  if (drawn && 'path' in drawn) return along(drawn.path, drawn.path === chosen ? `arrived at ${drawn.path.toName}` : `lost, came to ${drawn.path.toName}`)
  if (drawn) return { roll, note: `held up at ${place.node.name}`, moves: null, events: [meet({ kind: 'node', id: place.id })(drawn.event)] }
  return { roll, note: `lost, still at ${place.node.name}`, moves: null, events: [] }
}

// survival.tex "Search": "Characters find the easiest event of the type that
// was searched for and for which their test value was high enough";
// "Event DL": "A crit over the event DL allows interacting with it and, if
// the event does not take the whole ET, go for another event for which
// there was a hit or crit"; "Grazes and misses": otherwise a random event
// of the node. The roll is read against the event met, or, with none, the
// easiest one looked for.
function search(place: Place, group: Group, roll: TestRoll, meet: Meet, dice: Dice): Meeting {
  const events = listed(Object.entries(place.node.events))
  const met = events.map(meet({ kind: 'node', id: place.id })).sort((x, y) => x.DL - y.DL)
  const sought = met.filter((m) => events.find((l) => l.id === m.event)?.stage.types.includes(group.seek))
  const against = (m: Met | undefined): TestRoll => (m ? { ...roll, DL: m.DL, degree: m.degree } : roll)
  const found = sought.find((m) => isFound(m.degree))
  if (found) {
    const chain = [found]
    for (const m of met) {
      const last = chain[chain.length - 1]
      if (last.degree !== 'critical' || last.outcome.takesET) break
      if (!chain.includes(m) && isFound(m.degree)) chain.push(m)
    }
    return { roll: against(found), note: `found ${chain.map((m) => m.name).join(', then ')}`, moves: null, events: chain }
  }
  const drawn = drawWeighted<Listed | null>([
    ...events.map((l) => ({ weight: getEventWeight(l.stage.DL), item: l })),
    { weight: BLANK_WEIGHT, item: null },
  ], rollPercent(dice))
  if (!drawn) return { roll: against(sought[0]), note: `found no ${group.seek}`, moves: null, events: [] }
  const came = meet({ kind: 'node', id: place.id })(drawn)
  return { roll: against(sought[0]), note: `found no ${group.seek}, came upon ${came.name}`, moves: null, events: [came] }
}

// One group's test, made by its roller, and what it leaves the camp and
// where it takes the group. `start` is the camp as the ET found it; `going`
// who goes, whose memory of an event makes it easier to find.
function goOn(t: Exploring, partyId: string, groupId: string, start: Camp, group: Group, going: string[], test: Tester, dice: Dice): Outcome {
  const state = t.campaign
  const party = state.parties[partyId]
  const place = getPlace(state, party)
  const stays = { task: null, moves: null, events: [] as Met[] }
  if (group.kind === 'firewood' && !hasWood(t, partyId)) return { ...stays, roll: null, note: 'no wood here' }
  if (group.kind === 'fire' && start.firewood <= 0) return { ...stays, roll: null, note: 'no firewood' }
  if ((group.kind === 'firewood' || group.kind === 'fire') && start.progress.includes(group.kind)) {
    return { ...stays, roll: null, note: 'finished from the last ET', task: 'hit' }
  }
  // survival.tex "Lighting the fire": "done without a test if some items or
  // spells are present".
  if (group.kind === 'fire' && group.tool) return { ...stays, roll: null, note: 'lit with a tool', task: 'hit' }
  const groupTest = getGroupTest(state, partyId, group)
  if (!groupTest || !group.roller) return { ...stays, roll: null, note: 'nobody to roll' }
  const result = test({ id: `group:${partyId}:${groupId}`, roller: group.roller, label: group.kind, test: groupTest, mode: group.mode })
  if (!result) return { ...stays, roll: null, note: '' }
  const roll = toCallRoll(result)
  const known = (owner: EventOwner, id: string) => !!party.at && knowsEvent(t, going, getEventKey(party.at.map, owner, id))
  const meet = meeting(roll.score, getNightDL(state, party), known)
  if (group.kind === 'travel') return { task: null, ...(place && party.at ? travel(party.at, place, group, roll, meet, dice) : { roll, note: '', moves: { at: null }, events: [] }) }
  if (group.kind === 'search' && place) return { task: null, ...search(place, group, roll, meet, dice) }
  return { ...stays, roll, note: '', task: roll.degree }
}

type PartyET = { t: Exploring; results: GroupResult[]; castResults: CastResult[]; stayResults: StayResult[] }

type Step = (c: CampaignCharacter) => CampaignCharacter

const push = (landing: Record<string, Step[]>, id: string, step: Step) => {
  landing[id] = [...(landing[id] ?? []), step]
}

// survival.tex "Wear": paid as any cost is.
const payWear = (wear: Wear): Step => payCost({ AP: 0, STA: 0, ...wear }, false)

// What the party's casts over the ET came to: who spent it casting and the
// exhaustion each cast cost them, the health each target rests with on top,
// what lands on each, who a medic tended ("considered to be resting for the
// ET"), and what to read afterwards.
type CastET = {
  exhaustion: Record<string, number>
  bonus: Record<string, number>
  landing: Record<string, ((c: CampaignCharacter) => CampaignCharacter)[]>
  patients: string[]
  results: CastResult[]
}

const land = (out: CastET, id: string, step: (c: CampaignCharacter) => CampaignCharacter) => {
  out.landing[id] = [...(out.landing[id] ?? []), step]
}

// abilities.tex "Bone Setting": the medic's test, made once for the wound's
// bearer, who rests the ET. A set wound heals by the degree's rate every day
// from then on. "A crit does not spend the ET": the medic rests too.
function treatOver(out: CastET, state: CampaignState, id: string, key: ETMedicineKey, plan: CastPlan, targets: string[], base: Omit<CastResult, 'roll' | 'note' | 'tests'>, test: Tester) {
  const medic = state.characters[id]
  const bar = getETTreatBar(medic, key) ?? getETTreatPlanBar(targets.map((target) => state.characters[target]), plan)
  if (bar) {
    out.results.push({ ...base, roll: null, note: bar, tests: [] })
    return
  }
  const result = test({ id: `treat:${id}`, roller: id, label: base.spell, test: getETTreatTest(medic, key) })
  if (!result) return
  const roll = toCallRoll(result)
  out.patients.push(...targets)
  if (isETSpared(key, roll.degree)) out.patients.push(id)
  else out.exhaustion[id] = 0
  if (plan.wound !== null) land(out, targets[0], setWound(plan.wound, BONE_SETTING_PER_DAY[roll.degree]))
  out.results.push({ ...base, roll, note: `heals ${BONE_SETTING_PER_DAY[roll.degree]} a day`, tests: [] })
}

// spells.tex "Casting spells": each planned cast is paid and rolled; one
// that hits buys what was planned with its overflow and lands on whoever it
// was aimed at, who make the test it leaves them. A caster forced to rest
// rests instead, and one who cannot cast it is idle.
function castOver(t: Exploring, partyId: string, players: string[], forced: (id: string) => boolean, test: Tester): CastET {
  const state = t.campaign
  const name = (id: string) => getRosterName(state, id)
  const out: CastET = { exhaustion: {}, bonus: {}, landing: {}, patients: [], results: [] }
  for (const id of players) {
    const plan = t.exploration.casts[id]
    if (!plan) continue
    const { key } = plan
    const caster = state.characters[id]
    const reachable = getETCastTargets(state, id)
    const targets = plan.targets.filter((target) => reachable.includes(target))
    const base = { party: state.parties[partyId].name, caster: name(id), spell: isSpellKey(key) ? SPELLS[key].name : isETMedicine(key) ? ABILITIES[key].name : key, targets: targets.map(name) }
    if (forced(id)) {
      out.results.push({ ...base, roll: null, note: 'forced to rest', tests: [] })
      continue
    }
    if (isETMedicine(key)) {
      treatOver(out, state, id, key, plan, targets, base, test)
      continue
    }
    const bar = getETCastBar(caster, key)
    const castTest = !bar && isSpellKey(key) ? getETCastTest(caster, key) : null
    if (!castTest || !isSpellKey(key)) {
      out.results.push({ ...base, roll: null, note: bar ?? 'no casting DL', tests: [] })
      continue
    }
    if (needsLimb(key) && !hasPlannedLimb(caster, state.characters[targets[0]], plan)) {
      out.results.push({ ...base, roll: null, note: 'none of their lost limbs at hand', tests: [] })
      continue
    }
    const result = test({ id: `cast:${id}`, roller: id, label: `cast ${base.spell}`, test: castTest })
    if (!result) continue
    const bought = result.degree === 'hit' ? buyETImprovements(plan, result.HOP) : { effortless: false, enhance: 0 }
    out.exhaustion[id] = getETCastExhaustion(key, bought.effortless)
    if (result.degree !== 'hit') {
      out.results.push({ ...base, roll: toCallRoll(result), note: 'no effect', tests: [] })
      continue
    }
    if (SPELLS[key].type === 'charged') {
      out.landing[id] = [...(out.landing[id] ?? []), chargeItem(key, {}, '', plan.item)]
      out.results.push({ ...base, roll: toCallRoll(result), note: findCarriedItem(caster, plan.item)?.item.name ?? '', tests: [] })
      continue
    }
    // the limb put back is gone from the caster's hand
    if (needsLimb(key)) out.landing[id] = [...(out.landing[id] ?? []), consumeItem(plan.item)]
    const deliveries = produceETCast(caster, plan, bought.enhance)
    const bonus = getETRestBonus(key, bought.enhance)
    const tests: CastResult['tests'] = []
    for (const target of targets) {
      const theirs = getETTargetTest(caster, state.characters[target], key, plan.DL)
      const resisted = theirs ? test({ id: `target:${id}:${target}`, roller: target, label: `against ${base.spell}`, test: theirs }) : null
      if (resisted) tests.push({ name: name(target), roll: toCallRoll(resisted) })
      out.landing[target] = [...(out.landing[target] ?? []), deliverAll(deliveries)]
      out.bonus[target] = (out.bonus[target] ?? 0) + bonus
    }
    const improved = [bought.effortless ? 'effortless' : '', bought.enhance > 0 ? `enhanced x${bought.enhance}` : ''].filter(Boolean).join(', ')
    out.results.push({ ...base, roll: toCallRoll(result), note: targets.length === 0 ? 'aimed at nobody' : improved, tests })
  }
  return out
}

// One group's plan, resolved on its own: its test and the events it met,
// landing at once on whoever went — the action's wear (survival.tex "Wear";
// "Exhaustion": every ET but a rest adds +1 exhaustion), what each event met
// costs them and the tests it asks, and what it found on the party's pile.
// Where it moves to and what a camp task does to the camp take the whole ET,
// and wait for it to close.
// A plan whose events ask a test stops before landing, held for the table to
// change the test's DL; resolving it again lands it.
function resolveGroup(t: Exploring, partyId: string, groupId: string, test: Tester, dice: Dice, newId: () => string): Exploring {
  const state = t.campaign
  const party = state.parties[partyId]
  const group = getGroups(t, partyId)[groupId]
  const opening = t.exploration.opening
  if (!party || !group || !opening) return t
  const players = getPartyPlayers(state, partyId)
  const forced = (id: string) => isForcedToRest(opening.rolls[id]?.degree)
  const name = (id: string) => getRosterName(state, id)
  const done = (s: Exploring, resolved: Resolved): Exploring => ({
    ...s,
    exploration: { ...s.exploration, pending: null, resolved: { ...s.exploration.resolved, [partyId]: { ...s.exploration.resolved[partyId], [groupId]: resolved } } },
  })
  const members = group.members.filter((id) => players.includes(id))
  const forcedIn = members.filter(forced)
  const stayedFor = isAway(group.kind) ? forcedIn.filter((id) => opening.decisions[id] === 'stay') : []
  if (stayedFor.length > 0) {
    const result = { party: party.name, kind: group.kind, members: members.map(name), roll: null, note: `stayed with ${stayedFor.map(name).join(', ')}`, events: [] }
    return done(t, { result, working: [], moves: null, found: [], task: null })
  }
  const going = members.filter((id) => !forced(id))
  if (going.length === 0) return done(t, { result: null, working: [], moves: null, found: [], task: null })
  const pending = t.exploration.pending
  const held = pending && pending.party === partyId && pending.group === groupId ? pending.meeting : null
  const outcome: Outcome = held ? { ...held, task: null } : goOn(t, partyId, groupId, opening.start[partyId] ?? getCamp(t, partyId), group, going, test, dice)
  if (!held && outcome.events.some((e) => asksTable(e.outcome))) {
    const meeting = { roll: outcome.roll, note: outcome.note, moves: outcome.moves, events: outcome.events }
    return { ...t, exploration: { ...t.exploration, pending: { party: partyId, group: groupId, meeting } } }
  }
  const landing: Record<string, Step[]> = {}
  const action = getExplorationAction(group.kind)
  for (const id of going) push(landing, id, (c) => addExhaustion(1)(addIL(getWear(c, action))(c)))
  const found: Item[] = []
  const events = outcome.events.map((met, i): Met => {
    for (const id of going) push(landing, id, payWear(met.outcome.wear))
    for (const { key, amount } of met.outcome.items) {
      const item = getCatalogItem(key, amount)
      if (item) found.push({ ...item, id: newId() })
    }
    const check = met.outcome.test
    if (!check) return met
    const tests = going.flatMap((id) => {
      const eventTest: Test = { skill: skillLenses[check.skill].get(state.characters[id]), DL: check.DL + met.adjust, explodes: false, scale: 'degrees' }
      const result = test({ id: `event:${partyId}:${groupId}:${i}:${id}`, roller: id, label: `${met.name}: ${check.skill}`, test: eventTest })
      if (!result) return []
      const roll = toCallRoll(result)
      const landed = check.results[roll.degree]
      push(landing, id, payWear(landed.wear))
      return [{ name: name(id), roll, text: landed.text }]
    })
    return { ...met, tests }
  })
  const characters = { ...state.characters }
  for (const [id, steps] of Object.entries(landing)) {
    if (characters[id]) characters[id] = steps.reduce((c, step) => step(c), characters[id])
  }
  const carried = forcedIn.filter((id) => opening.decisions[id] === 'carry')
  const result = { party: party.name, kind: group.kind, members: going.map(name), roll: outcome.roll, note: outcome.note, events }
  const piles = found.length > 0 ? { ...t.exploration.piles, [partyId]: [...(t.exploration.piles[partyId] ?? []), ...found] } : t.exploration.piles
  // what the events met bring on the place for the ET, and the memory of them
  // whoever went keeps
  const key = getPlaceKey(party.at)
  const weather = events.flatMap((met) => (met.outcome.weather ? [met.outcome.weather] : []))
  const passing = key && weather.length > 0 ? { ...t.exploration.passing, [key]: [...(t.exploration.passing[key] ?? []), ...weather] } : t.exploration.passing
  const met = party.at ? events.map((e) => getEventKey(party.at!.map, e.owner, e.event)) : []
  const known = { ...t.exploration.known, ...Object.fromEntries(going.map((id) => [id, [...new Set([...(t.exploration.known[id] ?? []), ...met])]])) }
  return done(
    { campaign: { ...state, characters }, exploration: { ...t.exploration, piles, passing, known } },
    {
      result, working: going, moves: outcome.moves && { at: outcome.moves.at, ids: [...going, ...carried] }, found: found.map((i) => i.id),
      task: outcome.task && { kind: group.kind, degree: outcome.task },
    },
  )
}

// One party's ET closing, once every plan of it is resolved: the camp tasks
// land on the camp, in the order they were resolved, casts are cast, resters
// rest, and everyone else not spent on a plan is idle; survival.tex
// "Exhaustion": every ET but a rest adds +1 exhaustion. Everyone pays the
// terrain's wear. Every group that travelled somewhere leaves as a party of
// its own, taking what it found, unless it was the whole party, which leaves
// its camp behind instead.
function closeParty(t: Exploring, partyId: string, opening: Opening, test: Tester, newId: () => string): PartyET {
  const state = t.campaign
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId)
  const forced = (id: string) => isForcedToRest(opening.rolls[id]?.degree)
  const name = (id: string) => getRosterName(state, id)
  const wear = getTerrainWear(state, party)
  const start = opening.start[partyId] ?? getCamp(t, partyId)
  const resolved = Object.values(t.exploration.resolved[partyId] ?? {})
  const working = new Set(resolved.flatMap((r) => r.working))
  const moves = resolved.flatMap((r) => (r.moves ? [{ ...r.moves, found: r.found }] : []))
  const results = resolved.flatMap((r) => (r.result ? [r.result] : []))
  let camp = resolved.reduce((c, r) => (r.task ? landTask(r.task.kind, r.task.degree, c) : c), getCamp(t, partyId))
  // survival.tex "Campfire": a fire burns its firewood, 1 ET of it per ET.
  if (start.fire) camp = { ...camp, firewood: Math.max(0, camp.firewood - 1), fire: camp.firewood > 1 }

  const cast = castOver(t, partyId, players, forced, test)
  const exposure = getRestExposure(t, partyId)
  const day = getDay(party.clock as number)
  let count: Record<string, number> = {}
  for (const id of players) count[id] = getRestsToday(t, id)
  const characters = { ...state.characters }
  const stay: StayResult = { party: party.name, rested: [], idle: [] }
  for (const id of players) {
    const drank = spendPotion(characters[id])
    const spent = working.has(id)
    const casting = id in cast.exhaustion
    const resting = !spent && !casting && (forced(id) || t.exploration.resting.includes(id) || cast.patients.includes(id)) && canRestHeal(t, id)
    if (resting) count = { ...count, [id]: count[id] + 1 }
    if (resting) stay.rested.push(name(id))
    else if (!spent && !casting) stay.idle.push(name(id))
    const planned = resting ? rest(drank, exposure, cast.bonus[id] ?? 0)
      : spent ? drank
      : addExhaustion(1 + (cast.exhaustion[id] ?? 0))(drank)
    characters[id] = payWear(wear)(planned)
  }
  // what the casts put on their targets lands once the ET's rest is had, so
  // healing banked as a potion's is spent over the next
  for (const [id, steps] of Object.entries(cast.landing)) {
    if (characters[id]) characters[id] = steps.reduce((c, step) => step(c), characters[id])
  }
  const rests = { ...t.exploration.rests, ...Object.fromEntries(Object.entries(count).map(([id, n]) => [id, { day, count: n }])) }
  const exploration = { ...t.exploration, rests, camps: { ...t.exploration.camps, [partyId]: camp } }
  // the party lives the ET out before anyone leaves it, so whoever splits off
  // goes on from the time it reached
  const lived = passETs(1, [partyId])({ ...state, characters })
  const passed: Exploring = { campaign: lived, exploration }
  const stayResults = stay.rested.length + stay.idle.length > 0 ? [stay] : []
  const members = getPartyMembers(state, partyId)
  if (moves.length === 1 && members.every((id) => moves[0].ids.includes(id))) {
    const at = moves[0].at ?? party.at
    return {
      t: {
        campaign: { ...passed.campaign, parties: { ...passed.campaign.parties, [partyId]: { ...lived.parties[partyId], at } } },
        exploration: { ...exploration, camps: { ...exploration.camps, [partyId]: CampSchema.parse({ at }) } },
      },
      results,
      castResults: cast.results,
      stayResults,
    }
  }
  const split = moves.reduce((s, move) => {
    const newPartyId = newId()
    const added = addParty(newPartyId, { ...lived.parties[partyId], at: move.at ?? party.at })(s.campaign)
    const pile = s.exploration.piles[partyId] ?? []
    const piles = { ...s.exploration.piles, [partyId]: pile.filter((i) => !move.found.includes(i.id)), [newPartyId]: pile.filter((i) => move.found.includes(i.id)) }
    return {
      campaign: { ...added, partyOf: { ...added.partyOf, ...Object.fromEntries(move.ids.map((id) => [id, newPartyId])) } },
      exploration: { ...s.exploration, piles },
    }
  }, passed)
  return { t: split, results, castResults: cast.results, stayResults }
}

// The ET over: its plans emptied for the next, the groups, camps and piles
// of parties no longer there dropped, its tests kept to read.
type Played = Pick<PartyET, 'results' | 'castResults' | 'stayResults'>

function closeET(t: Exploring, opening: Opening, played: Played): Exploring {
  const here = (pid: string) => pid in t.campaign.parties
  const groups = Object.fromEntries(Object.entries(t.exploration.groups).filter(([pid]) => here(pid)).map(([pid, gs]) =>
    [pid, Object.fromEntries(Object.entries(gs).map(([gid, g]) => [gid, { ...g, members: [], roller: null }]))]))
  const camps = Object.fromEntries(Object.entries(t.exploration.camps).filter(([pid]) => here(pid)))
  const piles = Object.fromEntries(Object.entries(t.exploration.piles).filter(([pid, pile]) => here(pid) && pile.length > 0))
  return {
    campaign: t.campaign,
    exploration: {
      ...t.exploration, groups, camps, piles, resting: [], casts: {}, opening: null, resolved: {}, pending: null, running: null, passing: {}, calls: {},
      exhaustionRolls: opening.rolls, ...played,
    },
  }
}

// The ET opened by whichever press comes first, once the Will tests are in,
// and whether it is ready to go on: every decision they call for is made.
function openedET(t: Exploring, caller: Caller): { open: Exploring; ready: boolean } {
  const open = t.exploration.opening ? t : openET(t, caller.test)
  if (caller.waiting()) return { open: t, ready: false }
  return { open, ready: getDecisionsCalled(open).every((id) => !!open.exploration.opening?.decisions[id]) }
}

// One group's plan resolved on its own, refused as `getResolveBar` says; the
// ET opens with it if it is the first. It waits on the dice it calls for,
// and on the table where what it met asks a test.
export function resolvePlan(partyId: string, groupId: string, thrown: Throw, newId: () => string): ExplorationUpdater {
  return (t) => {
    if (getResolveBar(t, partyId, groupId)) return t
    const caller = makeCaller(t.exploration.calls, thrown)
    const waiting = (s: Exploring): Exploring => ({ ...s, exploration: { ...s.exploration, calls: caller.calls, running: { party: partyId, group: groupId } } })
    const { open, ready } = openedET(t, caller)
    if (!ready) return waiting(open)
    const resolved = resolveGroup(open, partyId, groupId, caller.test, caller.dice, newId)
    if (caller.waiting()) return waiting(open)
    return { ...resolved, exploration: { ...resolved.exploration, calls: {}, running: null } }
  }
}

// survival.tex "Exploration Turn (ET)": the ET passes at once for every
// party in play on a timeline, each on its own. It calls first for the Will
// tests it opens with; if one forces a rest on someone whose group goes away,
// the pass waits for the table to decide what happens to them, and the next
// press goes on. Then every plan not resolved yet is resolved in turn, the one
// waiting on the table first, each waiting on its dice and on the table as it
// would on its own. Then it calls for the tests of the casts, and for those a
// cast that landed leaves its targets, and closes the ET once every die is in.
export function passET(thrown: Throw, newId: () => string): ExplorationUpdater {
  return (t) => {
    if (getPassBar(t)) return t
    const caller = makeCaller(t.exploration.calls, thrown)
    const waiting = (s: Exploring): Exploring => ({ ...s, exploration: { ...s.exploration, calls: caller.calls, running: null } })
    const { open, ready } = openedET(t, caller)
    if (!ready) return waiting(open)
    const opening = open.exploration.opening ?? { rolls: {}, decisions: {}, start: {} }
    const pending = open.exploration.pending
    const plans = getPlayingParties(open.campaign, 'exploration').flatMap((partyId) => Object.keys(getGroups(open, partyId)).map((groupId) => ({ party: partyId, group: groupId })))
    const order = pending ? [{ party: pending.party, group: pending.group }, ...plans.filter((p) => p.party !== pending.party || p.group !== pending.group)] : plans
    let s = open
    for (const plan of order) {
      if (isResolved(s, plan.party, plan.group)) continue
      const next = resolveGroup(s, plan.party, plan.group, caller.test, caller.dice, newId)
      if (caller.waiting()) return waiting(s)
      s = next
      if (s.exploration.pending) return { ...s, exploration: { ...s.exploration, calls: {}, running: null } }
    }
    const played = getPlayingParties(s.campaign, 'exploration').reduce<Played & { t: Exploring }>((acc, partyId) => {
      const clock = acc.t.campaign.parties[partyId]?.clock ?? null
      const next = closeParty(acc.t, partyId, opening, caller.test, newId)
      const lines = getETResultLines(next.results, next.castResults, next.stayResults)
      const t = lines.length === 0 ? next.t : { ...next.t, campaign: record({ kind: 'et', party: partyId, title: 'an ET', lines, clock })(next.t.campaign) }
      return {
        t,
        results: [...acc.results, ...next.results],
        castResults: [...acc.castResults, ...next.castResults],
        stayResults: [...acc.stayResults, ...next.stayResults],
      }
    }, { t: s, results: [], castResults: [], stayResults: [] })
    if (caller.waiting()) return waiting(s)
    const { results, castResults, stayResults } = played
    return closeET(played.t, opening, { results, castResults, stayResults })
  }
}

// A die for a test the ET called for, typed in from the table or rolled on
// the screen; the last die called for plays on the press that called for
// them: the plan being resolved, or the ET passing.
export function answerET(callId: string, die: number, source: DieSource, thrown: Throw, newId: () => string): ExplorationUpdater {
  return (t) => {
    const calls = answerCall(t.exploration.calls, callId, die, source)
    if (calls === t.exploration.calls) return t
    const answered = { ...t, exploration: { ...t.exploration, calls } }
    if (getOpenCalls(calls).length > 0) return answered
    const running = t.exploration.running
    return running ? resolvePlan(running.party, running.group, thrown, newId)(answered) : passET(thrown, newId)(answered)
  }
}
