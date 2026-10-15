import { getRosterName } from '../../campaign/rules/roster'
import type { CampaignCharacter, Degree } from '../../types'
import type { At, CampaignState, CampaignUpdater, CrawlEvent } from '../../campaign/types'
import type { Camp, CastPlan, CastResult, Exploring, ExplorationUpdater, Group, GroupResult, Opening, StayResult, TestRoll } from '../types'
import { CampSchema } from '../types'
import { moded, rollPercent, type Dice } from '../../play/dice'
import { getDegree, resolveTest, toRoll } from '../../play/test'
import { getETResultLines } from '../projections/exploration'
import { addExhaustion, addIL, gainHunger, gainThirst, heal } from '../../character/commands/heal'
import {
  canRestHeal, getCamp, getExhaustionTest, getExplorationAction, getExplorationBar, getGroups, getGroupTest, getNightDL,
  getPassBar, getRestExposure, getRestsToday, getWear, hasWood, isAway, isForcedToRest,
} from '../rules/exploration'
import { getRestHealing, getRestRecovery } from '../../character/rules/recovery'
import { BLANK_WEIGHT, drawWeighted, getEventDL, getEventWeight, isFound } from '../rules/events'
import { getDay, getPlayingParties } from '../../campaign/rules/clock'
import { getConnectionsFrom, getPartyMembers, getPartyPlayers, getPlace, getTerrainWear, type Path, type Place } from '../../campaign/rules/place'
import { passETs } from '../../campaign/commands/clock'
import { record } from '../../campaign/commands/journal'
import { addParty } from '../../campaign/commands/parties'
import { updateRosterCharacter } from '../../campaign/commands/roster'
import { deliverAll } from '../../character/commands/deliver'
import { takeDose } from '../../character/commands/consume'
import { chargeItem, consumeItem } from '../../item/commands/hands'
import { findCarriedItem } from '../../item/rules/containers'
import { produceSpellEffect } from '../../character/rules/production'
import { SPELLS, isSpellKey } from '../../spells'
import { BONE_SETTING_PER_DAY, getETTreatBar, getETTreatPlanBar, getETTreatTest, isETMedicine, isETSpared, type ETMedicineKey } from '../rules/medicine'
import { setWound } from '../../character/commands/wounds'
import { ABILITIES } from '../../abilities'
import { buyETImprovements, hasPlannedLimb, needsLimb, getETCastBar, getETCastExhaustion, getETCastTargets, getETCastTest, getETRestBonus, getETTargetTest, produceETCast } from '../rules/casting'

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

// survival.tex "Exhaustion": the Will tests the coming ET opens with, rolled
// once for everyone who plays it.
function openET(t: Exploring, dice: Dice): Exploring {
  const state = t.campaign
  const rolls: Record<string, TestRoll> = {}
  for (const partyId of getPlayingParties(state)) {
    for (const id of getPartyPlayers(state, partyId)) {
      const test = getExhaustionTest(state.characters[id])
      if (test) rolls[id] = toRoll(resolveTest(test, dice))
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

type Met = GroupResult['events'][number]

// Where a group that went ends the ET: at a node of the map, or null off
// it. A group with no `moves` is where it started.
type Outcome = { roll: TestRoll | null; note: string; camp: Camp; moves: { at: At | null } | null; events: Met[] }

// survival.tex "Events": each event met resolves itself, by the degree the
// group's score comes to against it.
const meeting = (state: CampaignState, present: string[], score: number, night: number) => (event: CrawlEvent): Met => {
  const DL = getEventDL(state, present, night, event)
  const degree = getDegree(score, DL)
  return { name: event.name, DL, degree, outcome: event.outcomes[degree] }
}

type Drawn = { path: Path } | { event: CrawlEvent } | null

// survival.tex "Travel": "A crit or hit means that no one got lost";
// "Grazes and misses": a random event of the node, the path that was
// looked for among them, and "If the exploration test result is lower than
// 0, also add paths to other nodes". The group ends where what was drawn
// is: drawing a path, or an event on it, travels it. "Connection events:
// happen when traveling from one node to another", each met by the score.
function travel(from: At, place: Place, group: Group, roll: TestRoll, meet: (e: CrawlEvent) => Met, dice: Dice): Omit<Outcome, 'camp'> {
  const paths = getConnectionsFrom(place)
  const chosen = paths.find((p) => p.id === group.target)
  if (!chosen) return { roll, note: 'no path', moves: null, events: [] }
  const along = (path: Path, note: string) => ({ roll, note, moves: { at: { map: from.map, node: path.to } }, events: path.events.map(meet) })
  if (won(roll.degree)) return along(chosen, `arrived at ${chosen.toName}`)
  const weighted = (DL: number, item: Drawn) => ({ weight: getEventWeight(DL), item })
  const drawn = drawWeighted<Drawn>([
    ...Object.values(place.node.events).map((event) => weighted(event.DL, { event })),
    weighted(chosen.DL, { path: chosen }),
    ...chosen.events.map((event) => weighted(event.DL, { path: chosen })),
    ...(roll.score < 0 ? paths.filter((p) => p !== chosen).map((path) => weighted(path.DL, { path })) : []),
    { weight: BLANK_WEIGHT, item: null },
  ], rollPercent(dice))
  if (drawn && 'path' in drawn) return along(drawn.path, drawn.path === chosen ? `arrived at ${drawn.path.toName}` : `lost, came to ${drawn.path.toName}`)
  if (drawn) return { roll, note: `held up at ${place.node.name}`, moves: null, events: [meet(drawn.event)] }
  return { roll, note: `lost, still at ${place.node.name}`, moves: null, events: [] }
}

// survival.tex "Search": "Characters find the easiest event of the type that
// was searched for and for which their test value was high enough";
// "Grazes and misses": otherwise a random event of the node. The roll is
// read against the event met, or, with none, the easiest one looked for.
function search(place: Place, group: Group, roll: TestRoll, meet: (e: CrawlEvent) => Met, dice: Dice): Omit<Outcome, 'camp'> {
  const events = Object.values(place.node.events)
  const sought = events.filter((e) => e.types.includes(group.seek)).map(meet).sort((x, y) => x.DL - y.DL)
  const against = (met: Met | undefined): TestRoll => (met ? { ...roll, DL: met.DL, degree: met.degree } : roll)
  const found = sought.find((met) => isFound(met.degree))
  if (found) return { roll: against(found), note: `found ${found.name}`, moves: null, events: [found] }
  const drawn = drawWeighted<CrawlEvent | null>([
    ...events.map((event) => ({ weight: getEventWeight(event.DL), item: event })),
    { weight: BLANK_WEIGHT, item: null },
  ], rollPercent(dice))
  if (!drawn) return { roll: against(sought[0]), note: `found no ${group.seek}`, moves: null, events: [] }
  const met = meet(drawn)
  return { roll: against(sought[0]), note: `found no ${group.seek}, came upon ${drawn.name}`, moves: null, events: [met] }
}

// One group's test, made by its roller, and what it leaves the camp and
// where it takes the group. `start` is the camp as the ET found it.
function goOn(state: CampaignState, partyId: string, start: Camp, camp: Camp, group: Group, going: string[], dice: Dice): Outcome {
  const party = state.parties[partyId]
  const place = getPlace(state, party)
  const stays = { camp, moves: null, events: [] }
  if (group.kind === 'firewood' && !hasWood(state, party)) return { ...stays, roll: null, note: 'no wood here' }
  if (group.kind === 'fire' && start.firewood <= 0) return { ...stays, roll: null, note: 'no firewood' }
  if ((group.kind === 'firewood' || group.kind === 'fire') && start.progress.includes(group.kind)) {
    return { ...stays, roll: null, note: 'finished from the last ET', camp: landTask(group, 'hit', camp) }
  }
  // survival.tex "Lighting the fire": "done without a test if some items or
  // spells are present".
  if (group.kind === 'fire' && group.tool) return { ...stays, roll: null, note: 'lit with a tool', camp: landTask(group, 'hit', camp) }
  const test = getGroupTest(state, partyId, group)
  if (!test) return { ...stays, roll: null, note: 'nobody to roll' }
  const roll = toRoll(resolveTest(test, moded(group.mode, dice)))
  const meet = meeting(state, going, roll.score, getNightDL(state, party))
  if (group.kind === 'travel') return { camp, ...(place && party.at ? travel(party.at, place, group, roll, meet, dice) : { roll, note: '', moves: { at: null }, events: [] }) }
  if (group.kind === 'search' && place) return { camp, ...search(place, group, roll, meet, dice) }
  return { ...stays, roll, note: '', camp: landTask(group, roll.degree, camp) }
}

type PartyET = { t: Exploring; results: GroupResult[]; castResults: CastResult[]; stayResults: StayResult[] }

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
function treatOver(out: CastET, state: CampaignState, id: string, key: ETMedicineKey, plan: CastPlan, targets: string[], base: Omit<CastResult, 'roll' | 'note' | 'tests'>, dice: Dice) {
  const medic = state.characters[id]
  const bar = getETTreatBar(medic, key) ?? getETTreatPlanBar(targets.map((target) => state.characters[target]), plan)
  if (bar) {
    out.results.push({ ...base, roll: null, note: bar, tests: [] })
    return
  }
  const roll = toRoll(resolveTest(getETTreatTest(medic, key), dice))
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
function castOver(t: Exploring, partyId: string, players: string[], forced: (id: string) => boolean, dice: Dice): CastET {
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
      treatOver(out, state, id, key, plan, targets, base, dice)
      continue
    }
    const bar = getETCastBar(caster, key)
    const test = !bar && isSpellKey(key) ? getETCastTest(caster, key) : null
    if (!test || !isSpellKey(key)) {
      out.results.push({ ...base, roll: null, note: bar ?? 'no casting DL', tests: [] })
      continue
    }
    if (needsLimb(key) && !hasPlannedLimb(caster, state.characters[targets[0]], plan)) {
      out.results.push({ ...base, roll: null, note: 'none of their lost limbs at hand', tests: [] })
      continue
    }
    const result = resolveTest(test, dice)
    const bought = result.degree === 'hit' ? buyETImprovements(plan, result.HOP) : { effortless: false, enhance: 0 }
    out.exhaustion[id] = getETCastExhaustion(key, bought.effortless)
    if (result.degree !== 'hit') {
      out.results.push({ ...base, roll: toRoll(result), note: 'no effect', tests: [] })
      continue
    }
    if (SPELLS[key].type === 'charged') {
      out.landing[id] = [...(out.landing[id] ?? []), chargeItem(key, {}, '', plan.item)]
      out.results.push({ ...base, roll: toRoll(result), note: findCarriedItem(caster, plan.item)?.item.name ?? '', tests: [] })
      continue
    }
    // the limb put back is gone from the caster's hand
    if (needsLimb(key)) out.landing[id] = [...(out.landing[id] ?? []), consumeItem(plan.item)]
    const deliveries = produceETCast(caster, plan, bought.enhance)
    const bonus = getETRestBonus(key, bought.enhance)
    const tests: CastResult['tests'] = []
    for (const target of targets) {
      const theirs = getETTargetTest(caster, state.characters[target], key, plan.DL)
      if (theirs) tests.push({ name: name(target), roll: toRoll(resolveTest(theirs, dice)) })
      out.landing[target] = [...(out.landing[target] ?? []), deliverAll(deliveries)]
      out.bonus[target] = (out.bonus[target] ?? 0) + bonus
    }
    const improved = [bought.effortless ? 'effortless' : '', bought.enhance > 0 ? `enhanced x${bought.enhance}` : ''].filter(Boolean).join(', ')
    out.results.push({ ...base, roll: toRoll(result), note: targets.length === 0 ? 'aimed at nobody' : improved, tests })
  }
  return out
}

// One party's ET. Groups go on their actions, every member of a group that
// went takes its wear, resters rest, and everyone else is idle: survival.tex
// "Exhaustion": every ET but a rest adds +1 exhaustion. Every group that
// travelled somewhere leaves as a party of its own, unless it was the whole
// party, which leaves its camp behind instead.
function passParty(t: Exploring, partyId: string, opening: Opening, dice: Dice, newId: () => string): PartyET {
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

  for (const group of Object.values(getGroups(t, partyId))) {
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
    const outcome = goOn(state, partyId, start, camp, group, going, dice)
    camp = outcome.camp
    if (outcome.moves) moves.push({ at: outcome.moves.at, ids: [...going, ...forcedIn.filter((id) => opening.decisions[id] === 'carry')] })
    results.push({ party: party.name, kind: group.kind, members: going.map(name), roll: outcome.roll, note: outcome.note, events: outcome.events })
  }

  // survival.tex "Campfire": a fire burns its firewood, 1 ET of it per ET.
  if (start.fire) camp = { ...camp, firewood: Math.max(0, camp.firewood - 1), fire: camp.firewood > 1 }

  const cast = castOver(t, partyId, players, forced, dice)
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
    characters[id] = [addIL(wear.IL), addExhaustion(wear.exhaustion), gainHunger(wear.hunger), gainThirst(wear.thirst)]
      .reduce((c, step) => step(c), planned)
  }
  // what the casts put on their targets lands once the ET's rest is had, so
  // healing banked as a potion's is spent over the next
  for (const [id, landing] of Object.entries(cast.landing)) {
    if (characters[id]) characters[id] = landing.reduce((c, step) => step(c), characters[id])
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
  const campaign = moves.reduce((s, move) => {
    const newPartyId = newId()
    const added = addParty(newPartyId, { ...lived.parties[partyId], at: move.at ?? party.at })(s)
    return { ...added, partyOf: { ...added.partyOf, ...Object.fromEntries(move.ids.map((id) => [id, newPartyId])) } }
  }, passed.campaign)
  return { t: { ...passed, campaign }, results, castResults: cast.results, stayResults }
}

// The ET over: its plans emptied for the next, the groups and camps of
// parties no longer there dropped, its tests kept to read.
function closeET(t: Exploring, opening: Opening, played: Omit<PartyET, 't'>): Exploring {
  const here = (pid: string) => pid in t.campaign.parties
  const groups = Object.fromEntries(Object.entries(t.exploration.groups).filter(([pid]) => here(pid)).map(([pid, gs]) =>
    [pid, Object.fromEntries(Object.entries(gs).map(([gid, g]) => [gid, { ...g, members: [], roller: null }]))]))
  const camps = Object.fromEntries(Object.entries(t.exploration.camps).filter(([pid]) => here(pid)))
  return {
    campaign: { ...t.campaign, out: [] },
    exploration: { ...t.exploration, groups, camps, resting: [], casts: {}, opening: null, exhaustionRolls: opening.rolls, ...played },
  }
}

// survival.tex "Exploration Turn (ET)": the ET passes at once for every
// party in play on a timeline, each on its own. The first press rolls the Will tests it opens with; if one
// forces a rest on someone whose group goes away, the pass waits for the
// table to decide what happens to them, and the next press plays it out.
export function passET(dice: Dice, newId: () => string): ExplorationUpdater {
  return (t) => {
    if (getPassBar(t)) return t
    const opened = t.exploration.opening ? t : openET(t, dice)
    if (getPassBar(opened)) return opened
    const opening = opened.exploration.opening ?? { rolls: {}, decisions: {} }
    const played = getPlayingParties(opened.campaign).reduce<PartyET>((acc, partyId) => {
      const clock = acc.t.campaign.parties[partyId]?.clock ?? null
      const next = passParty(acc.t, partyId, opening, dice, newId)
      const lines = getETResultLines(next.results, next.castResults, next.stayResults)
      const t = lines.length === 0 ? next.t : { ...next.t, campaign: record({ kind: 'et', party: partyId, title: 'an ET', lines, clock })(next.t.campaign) }
      return {
        t,
        results: [...acc.results, ...next.results],
        castResults: [...acc.castResults, ...next.castResults],
        stayResults: [...acc.stayResults, ...next.stayResults],
      }
    }, { t: opened, results: [], castResults: [], stayResults: [] })
    const { t: closing, ...results } = played
    return closeET(closing, opening, results)
  }
}
