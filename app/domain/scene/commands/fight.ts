import type { CampaignCharacter } from '../../types'
import type { SceneState, Table, TableUpdater } from '../types'
import type { CampaignState } from '../../campaign/types'
import { leaveFight } from '../../character/commands/leaveFight'
import { resetCombat } from './resetCombat'
import { removeFromCombat } from './characters'
import { addToFight, deleteParty, joinFight } from './parties'
import { getEndSceneBar, getHomecoming, getJoinBar, getReturnBar, getSaveLogBar, isFromRoster } from '../rules/fight'
import { getOpenAction, getPlayingOutBar } from '../rules/log'
import { checkIn, checkOut, leaveForGood, lend, release } from '../../campaign/commands/roster'
import { passETs } from '../../campaign/commands/clock'
import { describeSpan } from '../../campaign/rules/clock'
import { record } from '../../campaign/commands/journal'
import { getFightLogLines } from '../projections/episode'
import { getFightReportLines } from '../projections/report'
import { getPartyMembers } from '../../campaign/rules/place'
import { getTableNames, withFreeId } from '../../campaign/rules/roster'
import { getFightName } from '../rules/fighters'
import { leaveBehind, leaveDead } from './episode'
import { isDead } from '../../character/rules/afflictions'

// Takes these characters off the roster and into the fight, under the ids
// they have, each in the party they are in, or one of their own if they are in
// none, going by the name the campaign gave them, or their sheet's, made
// apart from the names the campaign gave everyone else; refused when nobody
// can join (`getJoinBar`).
export function sendToFight(ids: string[]): TableUpdater {
  return (table) => getJoinBar(table.fight) ? table : ids.reduce(({ campaign, fight }, id) => {
    const c = campaign.characters[id]
    if (!c) return { campaign, fight }
    const partyId = campaign.partyOf[id] ?? id
    return { campaign: checkOut(id)(campaign), fight: inherit(campaign)(joinFight(c, partyId, campaign.parties[partyId]?.name ?? '', getTableNames(campaign, id), campaign.names[id])(fight)) }
  }, table)
}

// The fight keeps a flag of its own for what the campaign sets; it takes the
// campaign's as its characters join.
const inherit = (campaign: CampaignState) => (fight: SceneState): SceneState => ({ ...fight, breakage: campaign.breakage })

// gear.tex "Equipment Breakage": switched on or off for the campaign and the
// fight at once.
export const toggleBreakage: TableUpdater = (table) => {
  const breakage = !table.fight.breakage
  return { campaign: { ...table.campaign, breakage }, fight: { ...table.fight, breakage } }
}

// A character brought straight into the fight, under an id the campaign gives
// and lends them (`withFreeId`), in the party `into` names or the newest
// party the fight made (see `addToFight`).
export function loadIntoFight(char: CampaignCharacter, newId: () => string, into?: string): TableUpdater {
  return (table) => {
    if (getJoinBar(table.fight)) return table
    const added = withFreeId(table.campaign, char, newId)
    return {
      campaign: lend(added.id)(table.campaign),
      fight: inherit(table.campaign)(addToFight(added, newId, Object.keys(table.campaign.parties), getTableNames(table.campaign), into)(table.fight)),
    }
  }
}

// These characters go back to the roster as the fight left them, in the
// parties it left them in. A fight that ran rounds leaves its marks on them.
function giveBack(table: Table, leaving: CampaignCharacter[]): CampaignState {
  return leaving.filter((c) => !isDead(c)).reduce((campaign, c) => checkIn(table.fight.round > 0 ? leaveFight(c) : c, getHomecoming(table, c.id), getFightName(table.fight, c.id))(campaign), table.campaign)
}

// Takes a character out of the fight. One sent from the roster goes back to
// it rather than being lost; one brought straight into the fight is gone, and
// their id goes back to the campaign. Refused while an action is open.
export function removeFromFight(id: string): TableUpdater {
  return (table) => {
    const c = table.fight.characters[id]
    if (!c || getOpenAction(table.fight)) return table
    const campaign = isDead(c) ? leaveDead(table.fight, table.campaign, [c], (x) => isFromRoster(table, x)) : isFromRoster(table, id) ? giveBack(table, [c]) : release(id)(table.campaign)
    return { campaign, fight: removeFromCombat(id)(table.fight) }
  }
}

// Puts these characters of the fight back on the roster as the fight left
// them, in the parties it left them in — whoever joined the fight on its own
// joins the roster too. A party the last of whose fighters comes back has its
// clock moved on by the ETs the table says the scene took, if any, so the
// scene's time passes for a party once however its fighters come back. The
// fight ends when nobody is left in it.
export function returnFromFight(ids: string[], ets: number): TableUpdater {
  return (table) => (getReturnBar(table.fight) ? table : bringBack(table, ids, ets))
}

function bringBack(table: Table, ids: readonly string[], ets: number): Table {
  const leaving = Object.values(table.fight.characters).filter((c) => ids.includes(c.id))
  if (leaving.length === 0) return table
  const alive = leaving.filter((c) => !isDead(c))
  const homeOf = (id: string) => getHomecoming(table, id).partyId
  const staying = new Set(Object.values(table.fight.characters).filter((c) => !ids.includes(c.id) && !isDead(c)).map((c) => homeOf(c.id)))
  const homes = Map.groupBy(alive, (c) => homeOf(c.id))
  const done = [...homes.keys()].filter((pid) => !staying.has(pid))
  const back = leaveDead(table.fight, giveBack(table, alive), leaving.filter(isDead), (id) => isFromRoster(table, id))
  const recorded = [...homes].filter(([pid]) => back.parties[pid]).reduce((campaign, [pid, members]) => record({
    kind: 'scene', party: pid, title: 'back from a scene',
    lines: [members.map((c) => getFightName(table.fight, c.id)).join(', '), ...(!staying.has(pid) && ets > 0 ? [`the scene took ${describeSpan(ets)}`] : [])],
  })(campaign), back)
  const campaign = passETs(ets, done)(recorded)
  const fight = leaving.reduce((f, c) => removeFromCombat(c.id)(f), table.fight)
  if (Object.values(fight.characters).some((c) => !isDead(c))) return { campaign, fight }
  return { campaign: leaveBehind(fight, campaign), fight: resetCombat(fight) }
}

// The scene is over: whoever was sent
// from the roster comes back to it, as do those brought straight into the
// fight that the table `keep`s, in the parties the fight left them in, and the
// scene took `ets`. Every other one brought straight in is gone, their id back
// with the campaign. The dead and what is on the floor are left where it was
// met. Refused as `getEndSceneBar` says.
export function endScene(keep: readonly string[], ets: number): TableUpdater {
  return (table) => {
    if (getEndSceneBar(table.fight)) return table
    const here = Object.values(table.fight.characters)
    const gone = here.filter((c) => !isDead(c) && !isFromRoster(table, c.id) && !keep.includes(c.id)).map((c) => c.id)
    const left: Table = {
      campaign: gone.reduce((c, id) => release(id)(c), table.campaign),
      fight: gone.reduce((f, id) => removeFromCombat(id)(f), table.fight),
    }
    const rest = Object.keys(left.fight.characters)
    if (rest.length > 0) return bringBack(left, rest, ets)
    return { campaign: leaveBehind(left.fight, left.campaign), fight: resetCombat(left.fight) }
  }
}

// Everyone in the fight's party `partyId` is gone for good, alive or not:
// one sent from the roster leaves the campaign, one brought straight in gives
// their id back, and the dead are left lying where the fight was met. The
// party is gone from the fight; a fight left with nobody in it ends. Refused
// while something is being played out.
export function removePartyFromFight(partyId: string): TableUpdater {
  return (table) => {
    if (!table.fight.parties[partyId] || getPlayingOutBar(table.fight)) return table
    const members = Object.values(table.fight.characters).filter((c) => table.fight.partyOf[c.id] === partyId)
    const fromRoster = (id: string) => isFromRoster(table, id)
    const forgotten = members.filter((c) => !isDead(c)).reduce((c, m) => release(m.id)(fromRoster(m.id) ? leaveForGood(m.id)(c) : c), table.campaign)
    const withDead = leaveDead(table.fight, forgotten, members.filter(isDead), fromRoster)
    const emptied = members.reduce((f, m) => removeFromCombat(m.id)(f), table.fight)
    const fight = deleteParty(partyId)(emptied)
    if (Object.keys(fight.characters).length > 0) return { campaign: withDead, fight }
    return { campaign: leaveBehind(fight, withDead), fight: resetCombat(fight) }
  }
}

// Writes what the fight's log has gained since it was last saved to the
// journal, for every party of the campaign's with a fighter in it, at its
// moment, or for the campaign as a whole when none has.
export const saveFightLog: TableUpdater = (table) => {
  if (getSaveLogBar(table.fight) !== null) return table
  const lines = getFightLogLines(table.fight, table.fight.logSaved)
  const fight = { ...table.fight, logSaved: table.fight.landed.length }
  if (lines.length === 0) return { ...table, fight }
  const parties = [...new Set(Object.keys(table.fight.characters).map((id) => getHomecoming(table, id).partyId))].filter((pid) => table.campaign.parties[pid])
  const report = ['the fight so far, for each in it:', ...getFightReportLines(table.fight)]
  const campaign = (parties.length > 0 ? parties : [null]).reduce((c, party) => record({ kind: 'fight', party, title: 'the log of a fight', lines: [...lines, ...report] })(c), table.campaign)
  return { campaign, fight }
}

// The party's fighters back from the fight.
export function returnPartyFromFight(partyId: string, ets: number): TableUpdater {
  return (table) => returnFromFight(Object.keys(table.fight.characters).filter((id) => table.fight.partyOf[id] === partyId), ets)(table)
}

// Everyone in the party, off the roster and into the fight.
export function sendPartyToFight(partyId: string): TableUpdater {
  return (table) => sendToFight(getPartyMembers(table.campaign, partyId))(table)
}

// Throws the fight away, whatever is being played out in it: whoever was sent
// from the roster goes back to it as the fight left them, and whoever was
// brought straight into the fight is gone, their id back with the campaign.
// No time passes.
export const resetFight: TableUpdater = (table) => {
  const here = Object.values(table.fight.characters)
  const sent = here.filter((c) => isFromRoster(table, c.id))
  const brought = here.filter((c) => !isFromRoster(table, c.id) && !isDead(c)).map((c) => c.id)
  const returned = brought.reduce((c, id) => release(id)(c), giveBack(table, sent))
  return { campaign: leaveDead(table.fight, returned, here.filter(isDead), (id) => isFromRoster(table, id)), fight: resetCombat(table.fight) }
}
