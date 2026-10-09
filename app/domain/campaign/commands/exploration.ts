import type { CampaignCharacter } from '../../types'
import type { Camp, CampaignState, CampaignUpdater, Group, GroupResult, Opening, Party, TableUpdater, TestRoll } from '../types'
import { CampSchema } from '../types'
import { moded, type Dice } from '../../combat/dice'
import { resolveTest } from '../../combat/rules/test'
import type { Degree } from '../../combat/types'
import { heal } from '../../character/commands/heal'
import {
  canRestHeal, getExhaustionTest, getExplorationAction, getExplorationBar, getGroupTest, getPartyMembers, getPartyPlayers,
  getPassBar, getRestExposure, getRestHealing, getRestRecovery, getWear, isAway, isForcedToRest,
} from '../rules/exploration'
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

// One group's test, made by its roller, and what it leaves the camp. `start`
// is the camp as the ET found it.
function goOn(state: CampaignState, party: Party, start: Camp, camp: Camp, group: Group, dice: Dice): { roll: TestRoll | null; note: string; camp: Camp } {
  if (group.kind === 'fire' && start.firewood <= 0) return { roll: null, note: 'no firewood', camp }
  if ((group.kind === 'firewood' || group.kind === 'fire') && start.progress.includes(group.kind)) {
    return { roll: null, note: 'finished from the last ET', camp: landTask(group, 'hit', camp) }
  }
  // survival.tex "Lighting the fire": "done without a test if some items or
  // spells are present".
  if (group.kind === 'fire' && group.tool) return { roll: null, note: 'lit with a tool', camp: landTask(group, 'hit', camp) }
  const roll = toRoll(resolveTest(getGroupTest(state.characters[group.roller ?? ''], group, party), moded(group.mode, dice)))
  return { roll, note: '', camp: landTask(group, roll.degree, camp) }
}

type PartyET = { state: CampaignState; results: GroupResult[] }

// One party's ET. Groups go on their actions, every member of a group that
// went takes its wear, resters rest, and everyone else is idle: survival.tex
// "Exhaustion": every ET but a rest adds +1 exhaustion. A group that travelled
// leaves as a party of its own unless it was the whole party, which leaves
// its camp behind instead.
function passParty(state: CampaignState, partyId: string, opening: Opening, dice: Dice, newId: () => string): PartyET {
  const party = state.parties[partyId]
  const players = getPartyPlayers(state, partyId)
  const forced = (id: string) => isForcedToRest(opening.rolls[id]?.degree)
  const name = (id: string) => state.characters[id]?.fightName ?? id
  const start = party.camp
  let camp: Camp = { ...start, progress: [] }
  const working: Record<string, Group> = {}
  const movers: string[] = []
  const results: GroupResult[] = []

  for (const group of Object.values(party.groups)) {
    const members = group.members.filter((id) => players.includes(id))
    const forcedIn = members.filter(forced)
    const stayedFor = isAway(group.kind) ? forcedIn.filter((id) => opening.decisions[id] === 'stay') : []
    if (stayedFor.length > 0) {
      results.push({ party: party.name, kind: group.kind, members: members.map(name), roll: null, note: `stayed with ${stayedFor.map(name).join(', ')}` })
      continue
    }
    const going = members.filter((id) => !forced(id))
    if (going.length === 0) continue
    for (const id of going) working[id] = group
    if (group.kind === 'travel') movers.push(...going, ...forcedIn.filter((id) => opening.decisions[id] === 'carry'))
    const outcome = goOn(state, party, start, camp, group, dice)
    camp = outcome.camp
    results.push({ party: party.name, kind: group.kind, members: going.map(name), roll: outcome.roll, note: outcome.note })
  }

  // survival.tex "Campfire": a fire burns its firewood, 1 ET of it per ET.
  if (start.fire) camp = { ...camp, firewood: Math.max(0, camp.firewood - 1), fire: camp.firewood > 1 }

  const exposure = getRestExposure(party)
  let rests = state.rests
  const characters = { ...state.characters }
  for (const id of players) {
    const drank = spendPotion(characters[id])
    const group = working[id]
    const resting = !group && (forced(id) || state.resting.includes(id)) && canRestHeal({ ...state, rests }, id)
    if (resting) rests = { ...rests, [id]: (rests[id] ?? 0) + 1 }
    characters[id] = resting ? rest(drank, exposure)
      : group ? addExhaustion(1)(addIL(getWear(drank, getExplorationAction(group.kind)))(drank))
      : addExhaustion(1)(drank)
  }

  const passed: CampaignState = { ...state, characters, rests, parties: { ...state.parties, [partyId]: { ...party, camp } } }
  if (movers.length === 0) return { state: passed, results }
  const everyone = getPartyMembers(state, partyId).every((id) => movers.includes(id))
  if (everyone) return { state: { ...passed, parties: { ...passed.parties, [partyId]: { ...party, camp: CampSchema.parse({}) } } }, results }
  const newPartyId = newId()
  const split = addParty(newPartyId, party)(passed)
  return { state: { ...split, partyOf: { ...split.partyOf, ...Object.fromEntries(movers.map((id) => [id, newPartyId])) } }, results }
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
