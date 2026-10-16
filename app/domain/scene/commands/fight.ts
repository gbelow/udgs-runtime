import type { CampaignCharacter } from '../../types'
import type { Table, TableUpdater } from '../types'
import type { CampaignState } from '../../campaign/types'
import { leaveFight } from '../../character/commands/leaveFight'
import { resetCombat } from './resetCombat'
import { removeFromCombat } from './characters'
import { addToFight, joinFight } from './parties'
import { getHomecoming, getJoinBar, getReturnBar, getSaveLogBar, getTableIds, isFromRoster } from '../rules/fight'
import { getOpenAction } from '../rules/log'
import { addToRoster, checkIn, checkOut } from '../../campaign/commands/roster'
import { passETs } from '../../campaign/commands/clock'
import { describeSpan } from '../../campaign/rules/clock'
import { record } from '../../campaign/commands/journal'
import { getFightLogLines } from '../projections/episode'
import { getPartyMembers } from '../../campaign/rules/place'
import { getTableNames } from '../../campaign/rules/roster'
import { getFightName } from '../rules/fighters'

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
    return { campaign: checkOut(id)(campaign), fight: joinFight(c, partyId, campaign.parties[partyId]?.name ?? '', getTableNames(campaign, id), campaign.names[id])(fight) }
  }, table)
}

// A character brought straight into the fight, in the party `into` names or
// the newest party the fight made (see `addToFight`).
export function loadIntoFight(char: CampaignCharacter, newId: () => string, into?: string): TableUpdater {
  return (table) => getJoinBar(table.fight) ? table : ({
    campaign: table.campaign,
    fight: addToFight(char, newId, getTableIds(table), Object.keys(table.campaign.parties), getTableNames(table.campaign), into)(table.fight),
  })
}

export function loadOntoRoster(char: CampaignCharacter, newId: () => string, into?: string): TableUpdater {
  return (table) => ({ campaign: addToRoster(char, newId, getTableIds(table), into)(table.campaign), fight: table.fight })
}

// These characters go back to the roster as the fight left them, in the
// parties it left them in. A fight that ran rounds leaves its marks on them.
function giveBack(table: Table, leaving: CampaignCharacter[]): CampaignState {
  return leaving.reduce((campaign, c) => checkIn(table.fight.round > 0 ? leaveFight(c) : c, getHomecoming(table, c.id), getFightName(table.fight, c.id))(campaign), table.campaign)
}

// Takes a character out of the fight. One sent from the roster goes back to
// it rather than being lost; one brought straight into the fight is gone.
// Refused while an action is open.
export function removeFromFight(id: string): TableUpdater {
  return (table) => {
    const c = table.fight.characters[id]
    if (!c || getOpenAction(table.fight)) return table
    const campaign = isFromRoster(table, id) ? giveBack(table, [c]) : table.campaign
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
  return (table) => {
    if (getReturnBar(table.fight)) return table
    const leaving = Object.values(table.fight.characters).filter((c) => ids.includes(c.id))
    if (leaving.length === 0) return table
    const homeOf = (id: string) => getHomecoming(table, id).partyId
    const staying = new Set(Object.keys(table.fight.characters).filter((id) => !ids.includes(id)).map(homeOf))
    const homes = Map.groupBy(leaving, (c) => homeOf(c.id))
    const done = [...homes.keys()].filter((pid) => !staying.has(pid))
    const back = giveBack(table, leaving)
    const recorded = [...homes].filter(([pid]) => back.parties[pid]).reduce((campaign, [pid, members]) => record({
      kind: 'scene', party: pid, title: 'back from a scene',
      lines: [members.map((c) => getFightName(table.fight, c.id)).join(', '), ...(!staying.has(pid) && ets > 0 ? [`the scene took ${describeSpan(ets)}`] : [])],
    })(campaign), back)
    const campaign = passETs(ets, done)(recorded)
    const fight = leaving.reduce((f, c) => removeFromCombat(c.id)(f), table.fight)
    return { campaign, fight: Object.keys(fight.characters).length === 0 ? resetCombat(fight) : fight }
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
  const campaign = (parties.length > 0 ? parties : [null]).reduce((c, party) => record({ kind: 'fight', party, title: 'the log of a fight', lines })(c), table.campaign)
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
// brought straight into the fight is gone. No time passes.
export const resetFight: TableUpdater = (table) => {
  const sent = Object.values(table.fight.characters).filter((c) => isFromRoster(table, c.id))
  return { campaign: giveBack(table, sent), fight: resetCombat(table.fight) }
}
