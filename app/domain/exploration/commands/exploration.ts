import { getRosterName } from '../../campaign/rules/roster'
import type { CampaignCharacter, Degree, Item, SlotKind } from '../../types'
import type { At, CampaignState, CampaignUpdater, CrawlEvent, EventOwner, EventStage, Wear } from '../../campaign/types'
import type { Camp, CastPlan, CastResult, Exploring, ExplorationUpdater, Group, GroupResult, Meeting, Met, Opening, StayResult, TestRoll } from '../types'
import { CampSchema } from '../types'
import { rollPercent, type Dice, type DieSource } from '../../play/dice'
import { getDegree, type Test } from '../../play/test'
import { answerCall, getOpenCalls, makeCaller, toCallRoll, type CallResult, type CallSpec, type Throw } from '../../play/calls'
import { getETResultLines } from '../projections/exploration'
import { addExhaustion, addIL, heal } from '../../character/commands/heal'
import {
  canRestHeal, getCamp, getExhaustionTest, getExplorationAction, getExplorationBar, getGroups, getGroupTest, getNightDL,
  getPassBar, getRestExposure, getRestsToday, getToDowntimeBar, getWear, hasWood, isAway, isForcedToRest,
} from '../rules/exploration'
import { getRestHealing, getRestRecovery } from '../../character/rules/recovery'
import { BLANK_WEIGHT, asksTable, drawWeighted, getEventDL, getEventWeight, getStage, isFound } from '../rules/events'
import { getDay, getPlayingParties } from '../../campaign/rules/clock'
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

// What the table does to the DL of the test an event met asks, for what
// those meeting it do about it (a rope thrown down a climb).
export function adjustMet(partyId: string, groupId: string, index: number, adjust: number): ExplorationUpdater {
  return (t) => {
    const met = t.exploration.meeting?.[partyId]?.[groupId]
    if (!t.exploration.meeting || !met?.events[index]) return t
    const events = met.events.map((e, i) => (i === index ? { ...e, adjust } : e))
    const party = { ...t.exploration.meeting[partyId], [groupId]: { ...met, events } }
    return { ...t, exploration: { ...t.exploration, meeting: { ...t.exploration.meeting, [partyId]: party } } }
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
// once by everyone who plays it.
function openET(t: Exploring, test: Tester): Exploring {
  const state = t.campaign
  const rolls: Record<string, TestRoll> = {}
  for (const partyId of getPlayingParties(state, 'exploration')) {
    for (const id of getPartyPlayers(state, partyId)) {
      const will = getExhaustionTest(state.characters[id])
      const result = will ? test({ id: `will:${id}`, roller: id, label: 'Will against exhaustion', test: will }) : null
      if (result) rolls[id] = toCallRoll(result)
    }
  }
  return { ...t, exploration: { ...t.exploration, opening: { rolls, decisions: {} } } }
}

const won = (degree: Degree) => degree === 'hit' || degree === 'critical'

// survival.tex "Making camp": what a camp task's degree leaves the camp. A
// graze on firewood or the fire is progress the same task finishes the ET
// after ("spend double the time", "spend 2 ETs to succeed").
function landTask(group: Group, degree: Degree, camp: Camp): Camp {
  switch (group.kind) {
    case 'shelter': return degree === 'critical' ? { ...camp, shelter: 2 } : degree === 'hit' ? { ...camp, shelter: Math.max(camp.shelter, 1) } : camp
    case 'firewood':
    case 'fire': {
      if (degree === 'graze') return { ...camp, progress: [...camp.progress, group.kind] }
      if (!won(degree)) return camp
      // "The firewood is enough for 3 ETs."
      return group.kind === 'firewood' ? { ...camp, firewood: camp.firewood + 3 } : { ...camp, fire: true }
    }
    default: return camp
  }
}

// Where a group that went ends the ET: at a node of the map, or null off
// it. A group with no `moves` is where it started.
type Outcome = Meeting & { camp: Camp }

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
const meeting = (score: number, night: number): Meet => (owner) => ({ id, event, stage }) => {
  const DL = getEventDL(stage, night)
  const degree = getDegree(score, DL)
  return { owner, event: id, name: event.name, DL, degree, outcome: stage.outcomes[degree], adjust: 0, tests: [] }
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
  return { roll: against(sought[0]), note: `found no ${group.seek}, came upon ${drawn.event.name}`, moves: null, events: [meet({ kind: 'node', id: place.id })(drawn)] }
}

// One group's test, made by its roller, and what it leaves the camp and
// where it takes the group. `start` is the camp as the ET found it.
function goOn(state: CampaignState, partyId: string, groupId: string, start: Camp, camp: Camp, group: Group, test: Tester, dice: Dice): Outcome {
  const party = state.parties[partyId]
  const place = getPlace(state, party)
  const stays = { camp, moves: null, events: [] as Met[] }
  if (group.kind === 'firewood' && !hasWood(state, party)) return { ...stays, roll: null, note: 'no wood here' }
  if (group.kind === 'fire' && start.firewood <= 0) return { ...stays, roll: null, note: 'no firewood' }
  if ((group.kind === 'firewood' || group.kind === 'fire') && start.progress.includes(group.kind)) {
    return { ...stays, roll: null, note: 'finished from the last ET', camp: landTask(group, 'hit', camp) }
  }
  // survival.tex "Lighting the fire": "done without a test if some items or
  // spells are present".
  if (group.kind === 'fire' && group.tool) return { ...stays, roll: null, note: 'lit with a tool', camp: landTask(group, 'hit', camp) }
  const groupTest = getGroupTest(state, partyId, group)
  if (!groupTest || !group.roller) return { ...stays, roll: null, note: 'nobody to roll' }
  const result = test({ id: `group:${partyId}:${groupId}`, roller: group.roller, label: group.kind, test: groupTest, mode: group.mode })
  if (!result) return { ...stays, roll: null, note: '' }
  const roll = toCallRoll(result)
  const meet = meeting(roll.score, getNightDL(state, party))
  if (group.kind === 'travel') return { camp, ...(place && party.at ? travel(party.at, place, group, roll, meet, dice) : { roll, note: '', moves: { at: null }, events: [] }) }
  if (group.kind === 'search' && place) return { camp, ...search(place, group, roll, meet, dice) }
  return { ...stays, roll, note: '', camp: landTask(group, roll.degree, camp) }
}

type PartyET = { t: Exploring; results: GroupResult[]; castResults: CastResult[]; stayResults: StayResult[]; meetings: Record<string, Meeting>; asks: boolean }

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

// One party's ET. Groups go on their actions, every member of a group that
// went takes its wear, resters rest, and everyone else is idle: survival.tex
// "Exhaustion": every ET but a rest adds +1 exhaustion. Every group that
// travelled somewhere leaves as a party of its own, unless it was the whole
// party, which leaves its camp behind instead.
function passParty(t: Exploring, partyId: string, opening: Opening, test: Tester, dice: Dice, newId: () => string): PartyET {
  const state = t.campaign
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId)
  const forced = (id: string) => isForcedToRest(opening.rolls[id]?.degree)
  const name = (id: string) => getRosterName(state, id)
  const wear = getTerrainWear(state, party)
  const start = getCamp(t, partyId)
  let camp: Camp = { ...start, progress: [] }
  const working: Record<string, Group> = {}
  const moves: { at: At | null; ids: string[] }[] = []
  const results: GroupResult[] = []
  // what the events met land on whoever met them, once the table has looked
  // at those that ask it anything
  const asked = t.exploration.meeting !== null
  const meetings: Record<string, Meeting> = {}
  const metLanding: Record<string, Step[]> = {}
  const found: { ids: string[]; items: Item[] }[] = []
  let asks = false

  for (const [groupId, group] of Object.entries(getGroups(t, partyId))) {
    const members = group.members.filter((id) => players.includes(id))
    const forcedIn = members.filter(forced)
    const stayedFor = isAway(group.kind) ? forcedIn.filter((id) => opening.decisions[id] === 'stay') : []
    if (stayedFor.length > 0) {
      results.push({ party: party.name, kind: group.kind, members: members.map(name), roll: null, note: `stayed with ${stayedFor.map(name).join(', ')}`, events: [] })
      continue
    }
    const going = members.filter((id) => !forced(id))
    if (going.length === 0) continue
    for (const id of going) working[id] = group
    const held = isAway(group.kind) ? t.exploration.meeting?.[partyId]?.[groupId] : undefined
    const outcome: Outcome = held ? { ...held, camp } : goOn(state, partyId, groupId, start, camp, group, test, dice)
    camp = outcome.camp
    if (isAway(group.kind)) meetings[groupId] = { roll: outcome.roll, note: outcome.note, moves: outcome.moves, events: outcome.events }
    const events = outcome.events.map((met, i): Met => {
      if (asksTable(met.outcome) && !asked) {
        asks = true
        return met
      }
      for (const id of going) push(metLanding, id, payWear(met.outcome.wear))
      const items = met.outcome.items.flatMap(({ key, amount }) => {
        const item = getCatalogItem(key, amount)
        return item ? [{ ...item, id: newId() }] : []
      })
      if (items.length > 0) found.push({ ids: going, items })
      const check = met.outcome.test
      if (!check) return met
      const tests = going.flatMap((id) => {
        const label = `${met.name}: ${check.skill}`
        const eventTest: Test = { skill: skillLenses[check.skill].get(state.characters[id]), DL: check.DL + met.adjust, explodes: false, scale: 'degrees' }
        const result = test({ id: `event:${partyId}:${groupId}:${i}:${id}`, roller: id, label, test: eventTest })
        if (!result) return []
        const roll = toCallRoll(result)
        const landed = check.results[roll.degree]
        push(metLanding, id, payWear(landed.wear))
        return [{ name: name(id), roll, text: landed.text }]
      })
      return { ...met, tests }
    })
    if (outcome.moves) moves.push({ at: outcome.moves.at, ids: [...going, ...forcedIn.filter((id) => opening.decisions[id] === 'carry')] })
    results.push({ party: party.name, kind: group.kind, members: going.map(name), roll: outcome.roll, note: outcome.note, events })
  }

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
    const group = working[id]
    const casting = id in cast.exhaustion
    const resting = !group && !casting && (forced(id) || t.exploration.resting.includes(id) || cast.patients.includes(id)) && canRestHeal(t, id)
    if (resting) count = { ...count, [id]: count[id] + 1 }
    if (resting) stay.rested.push(name(id))
    else if (!group && !casting) stay.idle.push(name(id))
    const planned = resting ? rest(drank, exposure, cast.bonus[id] ?? 0)
      : group ? addExhaustion(1)(addIL(getWear(drank, getExplorationAction(group.kind)))(drank))
      : addExhaustion(1 + (cast.exhaustion[id] ?? 0))(drank)
    characters[id] = payWear(wear)(planned)
  }
  // what the casts put on their targets lands once the ET's rest is had, so
  // healing banked as a potion's is spent over the next
  for (const landing of [cast.landing, metLanding]) {
    for (const [id, steps] of Object.entries(landing)) {
      if (characters[id]) characters[id] = steps.reduce((c, step) => step(c), characters[id])
    }
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
      t: pileUp({
        campaign: { ...passed.campaign, parties: { ...passed.campaign.parties, [partyId]: { ...lived.parties[partyId], at } } },
        exploration: { ...exploration, camps: { ...exploration.camps, [partyId]: CampSchema.parse({ at }) } },
      }, found),
      results,
      castResults: cast.results,
      stayResults,
      meetings,
      asks,
    }
  }
  const campaign = moves.reduce((s, move) => {
    const newPartyId = newId()
    const added = addParty(newPartyId, { ...lived.parties[partyId], at: move.at ?? party.at })(s)
    return { ...added, partyOf: { ...added.partyOf, ...Object.fromEntries(move.ids.map((id) => [id, newPartyId])) } }
  }, passed.campaign)
  return { t: pileUp({ ...passed, campaign }, found), results, castResults: cast.results, stayResults, meetings, asks }
}

// survival.tex "Events": what a group found goes to the pile of the party
// it ends the ET in, for the table to share out.
function pileUp(t: Exploring, found: { ids: string[]; items: Item[] }[]): Exploring {
  return found.reduce((acc, { ids, items }) => {
    const partyId = acc.campaign.partyOf[ids[0]]
    if (!partyId) return acc
    const piles = { ...acc.exploration.piles, [partyId]: [...(acc.exploration.piles[partyId] ?? []), ...items] }
    return { ...acc, exploration: { ...acc.exploration, piles } }
  }, t)
}

// The ET over: its plans emptied for the next, the groups and camps of
// parties no longer there dropped, its tests kept to read.
type Played = Pick<PartyET, 'results' | 'castResults' | 'stayResults'>

function closeET(t: Exploring, opening: Opening, played: Played): Exploring {
  const here = (pid: string) => pid in t.campaign.parties
  const groups = Object.fromEntries(Object.entries(t.exploration.groups).filter(([pid]) => here(pid)).map(([pid, gs]) =>
    [pid, Object.fromEntries(Object.entries(gs).map(([gid, g]) => [gid, { ...g, members: [], roller: null }]))]))
  const camps = Object.fromEntries(Object.entries(t.exploration.camps).filter(([pid]) => here(pid)))
  const piles = Object.fromEntries(Object.entries(t.exploration.piles).filter(([pid, pile]) => here(pid) && pile.length > 0))
  return {
    campaign: t.campaign,
    exploration: { ...t.exploration, groups, camps, piles, resting: [], casts: {}, opening: null, meeting: null, calls: {}, exhaustionRolls: opening.rolls, ...played },
  }
}

// survival.tex "Exploration Turn (ET)": the ET passes at once for every
// party in play on a timeline, each on its own. It calls first for the Will
// tests it opens with; if one forces a rest on someone whose group goes away,
// the pass waits for the table to decide what happens to them, and the next
// press goes on. Then it calls for the tests of its groups and casts, and for
// those a cast that landed leaves its targets. Where an event met asks a test
// of anyone, it stops with what was met held, for the table to change the
// DL of the test by what they do; the next press calls those tests. It plays
// the ET out once every die is in.
export function passET(thrown: Throw, newId: () => string): ExplorationUpdater {
  return (t) => {
    if (getPassBar(t)) return t
    const caller = makeCaller(t.exploration.calls, thrown)
    const dice = caller.dice
    const waiting = (s: Exploring): Exploring => ({ ...s, exploration: { ...s.exploration, calls: caller.calls } })
    const opened = t.exploration.opening ? t : openET(t, caller.test)
    if (getOpenCalls(caller.calls).length > 0) return waiting(t)
    if (getPassBar(opened)) return waiting(opened)
    const opening = opened.exploration.opening ?? { rolls: {}, decisions: {} }
    const played = getPlayingParties(opened.campaign, 'exploration').reduce<Played & { t: Exploring; meeting: Record<string, Record<string, Meeting>>; asks: boolean }>((acc, partyId) => {
      const clock = acc.t.campaign.parties[partyId]?.clock ?? null
      const next = passParty(acc.t, partyId, opening, caller.test, dice, newId)
      const lines = getETResultLines(next.results, next.castResults, next.stayResults)
      const t = lines.length === 0 ? next.t : { ...next.t, campaign: record({ kind: 'et', party: partyId, title: 'an ET', lines, clock })(next.t.campaign) }
      return {
        t,
        results: [...acc.results, ...next.results],
        castResults: [...acc.castResults, ...next.castResults],
        stayResults: [...acc.stayResults, ...next.stayResults],
        meeting: { ...acc.meeting, [partyId]: next.meetings },
        asks: acc.asks || next.asks,
      }
    }, { t: opened, results: [], castResults: [], stayResults: [], meeting: {}, asks: false })
    if (getOpenCalls(caller.calls).length > 0) return waiting(opened)
    // what was met waits for the table before the tests it asks are called
    if (played.asks) return { ...opened, exploration: { ...opened.exploration, calls: caller.calls, meeting: played.meeting } }
    const { results, castResults, stayResults } = played
    return closeET(played.t, opening, { results, castResults, stayResults })
  }
}

// A die for a test the ET called for, typed in from the table or rolled on
// the screen; the last die called for plays the ET on.
export function answerET(callId: string, die: number, source: DieSource, thrown: Throw, newId: () => string): ExplorationUpdater {
  return (t) => {
    const calls = answerCall(t.exploration.calls, callId, die, source)
    if (calls === t.exploration.calls) return t
    const answered = { ...t, exploration: { ...t.exploration, calls } }
    return getOpenCalls(calls).length > 0 ? answered : passET(thrown, newId)(answered)
  }
}
