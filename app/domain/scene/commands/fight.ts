import type { CampaignCharacter } from '../../types'
import type { Table, TableUpdater } from '../types'
import type { CampaignState } from '../../campaign/types'
import { leaveFight } from '../../character/commands/leaveFight'
import { resetCombat } from './resetCombat'
import { removeFromCombat } from './characters'
import { addToFight, joinFight } from './parties'
import { getHomecoming, getJoinBar, getReturnBar, getTableIds, isFromRoster } from '../rules/fight'
import { getOpenAction } from '../rules/log'
import { addToRoster, checkIn, checkOut } from '../../campaign/commands/roster'
import { passETs } from '../../campaign/commands/clock'
import { getPartyMembers } from '../../campaign/rules/place'

// Takes these characters off the roster and into the fight, under the ids
// they have, each in the party they are in, or one of their own if they are in
// none; refused when nobody can join (`getJoinBar`).
export function sendToFight(ids: string[]): TableUpdater {
  return (table) => getJoinBar(table.fight) ? table : ids.reduce(({ campaign, fight }, id) => {
    const c = campaign.characters[id]
    if (!c) return { campaign, fight }
    const partyId = campaign.partyOf[id] ?? id
    return { campaign: checkOut(id)(campaign), fight: joinFight(c, partyId, campaign.parties[partyId]?.name ?? '')(fight) }
  }, table)
}

// A character brought straight into the fight, in the party `into` names or
// the newest party the fight made (see `addToFight`).
export function loadIntoFight(char: CampaignCharacter, newId: () => string, into?: string): TableUpdater {
  return (table) => getJoinBar(table.fight) ? table : ({
    campaign: table.campaign,
    fight: addToFight(char, newId, getTableIds(table), Object.keys(table.campaign.parties), into)(table.fight),
  })
}

export function loadOntoRoster(char: CampaignCharacter, newId: () => string, into?: string): TableUpdater {
  return (table) => ({ campaign: addToRoster(char, newId, getTableIds(table), into)(table.campaign), fight: table.fight })
}

// These characters go back to the roster as the fight left them, in the
// parties it left them in. A fight that ran rounds leaves its marks on them.
function giveBack(table: Table, leaving: CampaignCharacter[]): CampaignState {
  return leaving.reduce((campaign, c) => checkIn(table.fight.round > 0 ? leaveFight(c) : c, getHomecoming(table, c.id))(campaign), table.campaign)
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
    const done = [...new Set(leaving.map((c) => homeOf(c.id)))].filter((pid) => !staying.has(pid))
    const campaign = passETs(ets, done)(giveBack(table, leaving))
    const fight = leaving.reduce((f, c) => removeFromCombat(c.id)(f), table.fight)
    return { campaign, fight: Object.keys(fight.characters).length === 0 ? resetCombat(fight) : fight }
  }
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
