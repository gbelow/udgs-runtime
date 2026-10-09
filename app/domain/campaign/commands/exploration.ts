import type { CampaignCharacter } from '../../types'
import type { Camp, CampaignState, CampaignUpdater, CrawlEvent, Group, GroupResult, Opening, TableUpdater, TestRoll } from '../types'
import { CampSchema } from '../types'
import { moded, rollPercent, type Dice } from '../../combat/dice'
import { getDegree, resolveTest } from '../../combat/rules/test'
import type { Degree } from '../../combat/types'
import { gainHunger, gainThirst, heal } from '../../character/commands/heal'
import {
  canRestHeal, getConnectionsFrom, getExhaustionTest, getExplorationAction, getExplorationBar, getGroupTest, getNightDL, getPartyMembers,
  getPartyPlayers, getPassBar, getPlace, getRestExposure, getTerrainWear, getRestHealing, getRestRecovery, getWear, hasWood, isAway, isForcedToRest,
  type Path, type Place,
} from '../rules/exploration'
import { BLANK_WEIGHT, drawWeighted, getEventDL, getEventWeight, isFound } from '../rules/crawl'
import { getNextET } from '../rules/clock'
import { advanceClock } from './clock'
import { addParty } from './parties'
import { updateRosterCharacter } from './roster'

const onCharacter = (id: string, update: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater =>
  (state) => (getExplorationBar(state, id) ? state : updateRosterCharacter(id, update)(state))

// survival.tex "Hunger": "Each portion eaten recovers a number of hunger
// points defined in the portion itself."
export function eat(id: string, nutrition: number): CampaignUpdater {
  return onCharacter(id, (c) =>
    ({ ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, nutrition)) } }))
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

const addExhaustion = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, resources: { ...c.resources, exhaustion: Math.max(0, c.resources.exhaustion + amount) } })

const addIL = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + amount } })

// survival.tex "Rest": exhaustion lowers and IL heals, by negative amounts on
// ground rough enough to work against the character.
function rest(c: CampaignCharacter, exposure: number): CampaignCharacter {
  const recovered = addExhaustion(-getRestRecovery(exposure))(c)
  const healing = getRestHealing(c, exposure)
  return healing < 0 ? addIL(-healing)(recovered) : heal(Math.min(healing, recovered.injuries.injuryLevel))(recovered)
}

const toRoll = ({ die, score, DL, degree }: TestRoll): TestRoll => ({ die, score, DL, degree })

// survival.tex "Exhaustion": the Will tests the coming ET opens with, rolled
// once for everyone who plays it.
function openET(state: CampaignState, dice: Dice): CampaignState {
  const rolls: Record<string, TestRoll> = {}
  for (const partyId of Object.keys(state.parties)) {
    for (const id of getPartyPlayers(state, partyId)) {
      const test = getExhaustionTest(state.characters[id])
      if (test) rolls[id] = toRoll(resolveTest(test, dice))
    }
  }
  return { ...state, opening: { rolls, decisions: {} } }
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

// Where a group that went ends the ET: `node` on the map, null off it. A
// group with no `moves` is where it started.
type Outcome = { roll: TestRoll | null; note: string; camp: Camp; moves: { node: string | null } | null; events: Met[] }

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
function travel(state: CampaignState, place: Place, group: Group, roll: TestRoll, meet: (e: CrawlEvent) => Met, dice: Dice): Omit<Outcome, 'camp'> {
  const paths = getConnectionsFrom(state, place.id)
  const chosen = paths.find((p) => p.id === group.target)
  if (!chosen) return { roll, note: 'no path', moves: null, events: [] }
  const along = (path: Path, note: string) => ({ roll, note, moves: { node: path.to }, events: path.events.map(meet) })
  const nameOf = (node: string) => state.map?.nodes[node]?.name ?? node
  if (won(roll.degree)) return along(chosen, `arrived at ${nameOf(chosen.to)}`)
  const weighted = (DL: number, item: Drawn) => ({ weight: getEventWeight(DL), item })
  const drawn = drawWeighted<Drawn>([
    ...Object.values(place.node.events).map((event) => weighted(event.DL, { event })),
    weighted(chosen.DL, { path: chosen }),
    ...chosen.events.map((event) => weighted(event.DL, { path: chosen })),
    ...(roll.score < 0 ? paths.filter((p) => p !== chosen).map((path) => weighted(path.DL, { path })) : []),
    { weight: BLANK_WEIGHT, item: null },
  ], rollPercent(dice))
  if (drawn && 'path' in drawn) return along(drawn.path, drawn.path === chosen ? `arrived at ${nameOf(drawn.path.to)}` : `lost, came to ${nameOf(drawn.path.to)}`)
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
  if (group.kind === 'travel') return { camp, ...(place ? travel(state, place, group, roll, meet, dice) : { roll, note: '', moves: { node: null }, events: [] }) }
  if (group.kind === 'search' && place) return { camp, ...search(place, group, roll, meet, dice) }
  return { ...stays, roll, note: '', camp: landTask(group, roll.degree, camp) }
}

type PartyET = { state: CampaignState; results: GroupResult[] }

// One party's ET. Groups go on their actions, every member of a group that
// went takes its wear, resters rest, and everyone else is idle: survival.tex
// "Exhaustion": every ET but a rest adds +1 exhaustion. Every group that
// travelled somewhere leaves as a party of its own, unless it was the whole
// party, which leaves its camp behind instead.
function passParty(state: CampaignState, partyId: string, opening: Opening, dice: Dice, newId: () => string): PartyET {
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId)
  const forced = (id: string) => isForcedToRest(opening.rolls[id]?.degree)
  const name = (id: string) => state.characters[id]?.fightName ?? id
  const wear = getTerrainWear(state, party)
  const start = party.camp
  let camp: Camp = { ...start, progress: [] }
  const working: Record<string, Group> = {}
  const moves: { node: string | null; ids: string[] }[] = []
  const results: GroupResult[] = []

  for (const group of Object.values(party.groups)) {
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
    if (outcome.moves) moves.push({ node: outcome.moves.node, ids: [...going, ...forcedIn.filter((id) => opening.decisions[id] === 'carry')] })
    results.push({ party: party.name, kind: group.kind, members: going.map(name), roll: outcome.roll, note: outcome.note, events: outcome.events })
  }

  // survival.tex "Campfire": a fire burns its firewood, 1 ET of it per ET.
  if (start.fire) camp = { ...camp, firewood: Math.max(0, camp.firewood - 1), fire: camp.firewood > 1 }

  const exposure = getRestExposure(state, party)
  let rests = state.rests
  const characters = { ...state.characters }
  for (const id of players) {
    const drank = spendPotion(characters[id])
    const group = working[id]
    const resting = !group && (forced(id) || state.resting.includes(id)) && canRestHeal({ ...state, rests }, id)
    if (resting) rests = { ...rests, [id]: (rests[id] ?? 0) + 1 }
    const planned = resting ? rest(drank, exposure)
      : group ? addExhaustion(1)(addIL(getWear(drank, getExplorationAction(group.kind)))(drank))
      : addExhaustion(1)(drank)
    characters[id] = [addIL(wear.IL), addExhaustion(wear.exhaustion), gainHunger(wear.hunger), gainThirst(wear.thirst)]
      .reduce((c, step) => step(c), planned)
  }

  const passed: CampaignState = { ...state, characters, rests, parties: { ...state.parties, [partyId]: { ...party, camp } } }
  const members = getPartyMembers(state, partyId)
  if (moves.length === 1 && members.every((id) => moves[0].ids.includes(id))) {
    const moved = { ...party, camp: CampSchema.parse({}), node: moves[0].node ?? party.node }
    return { state: { ...passed, parties: { ...passed.parties, [partyId]: moved } }, results }
  }
  const split = moves.reduce((s, move) => {
    const newPartyId = newId()
    const added = addParty(newPartyId, { ...party, node: move.node ?? party.node })(s)
    return { ...added, partyOf: { ...added.partyOf, ...Object.fromEntries(move.ids.map((id) => [id, newPartyId])) } }
  }, passed)
  return { state: split, results }
}

// The ET over: its plans emptied for the next, its tests kept to read.
function closeET(state: CampaignState, opening: Opening, results: GroupResult[]): CampaignState {
  const parties = Object.fromEntries(Object.entries(state.parties).map(([pid, p]) =>
    [pid, { ...p, groups: Object.fromEntries(Object.entries(p.groups).map(([gid, g]) => [gid, { ...g, members: [], roller: null }])) }]))
  return { ...state, parties, resting: [], out: [], opening: null, exhaustionRolls: opening.rolls, results }
}

// survival.tex "Exploration Turn (ET)": the ET passes for everyone on the
// roster at once. The first press rolls the Will tests it opens with; if one
// forces a rest on someone whose group goes away, the pass waits for the
// table to decide what happens to them, and the next press plays it out.
export function passET(dice: Dice, newId: () => string): TableUpdater {
  return (table) => {
    if (getPassBar(table)) return table
    const opened = table.campaign.opening ? table.campaign : openET(table.campaign, dice)
    if (getPassBar({ ...table, campaign: opened })) return { ...table, campaign: opened }
    const opening = opened.opening ?? { rolls: {}, decisions: {} }
    const played = Object.keys(opened.parties).reduce<PartyET>((acc, partyId) => {
      const next = passParty(acc.state, partyId, opening, dice, newId)
      return { state: next.state, results: [...acc.results, ...next.results] }
    }, { state: opened, results: [] })
    return { ...table, campaign: advanceClock(getNextET(opened.clock))(closeET(played.state, opening, played.results)) }
  }
}
