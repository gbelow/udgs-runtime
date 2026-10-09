import type { CampaignCharacter } from '../../types'
import type { Table, TableUpdater } from '../types'
import type { CampaignState } from '../../campaign/types'
import { leaveFight } from '../../character/commands/leaveFight'
import { resetCombat } from './resetCombat'
import { removeFromCombat } from './characters'
import { addToFight, joinFight } from './parties'
import { getHomecoming, getReturnBar, getTableIds, isFromRoster } from '../rules/fight'
import { getOpenAction } from '../rules/log'
import { addToRoster, checkIn, checkOut } from '../../campaign/commands/roster'
import { passETs } from '../../campaign/commands/clock'

// Takes these characters off the roster and into the fight, under the ids
// they have, each in the party they are in, or one of their own if they are in
// none.
export function sendToFight(ids: string[]): TableUpdater {
  return (table) => ids.reduce(({ campaign, fight }, id) => {
    const c = campaign.characters[id]
    if (!c) return { campaign, fight }
    const partyId = campaign.partyOf[id] ?? id
    return { campaign: checkOut(id)(campaign), fight: joinFight(c, partyId, campaign.parties[partyId]?.name ?? '')(fight) }
  }, table)
}

// A character brought straight into the fight, in the newest party the fight
// made (see `addToFight`).
export function loadIntoFight(char: CampaignCharacter, newId: () => string): TableUpdater {
  return (table) => ({
    campaign: table.campaign,
    fight: addToFight(char, newId, getTableIds(table), Object.keys(table.campaign.parties))(table.fight),
  })
}

export function loadOntoRoster(char: CampaignCharacter, newId: () => string): TableUpdater {
  return (table) => ({ campaign: addToRoster(char, newId, getTableIds(table))(table.campaign), fight: table.fight })
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

// Ends the fight and puts everyone in it back on the roster as the fight left
// them, in the parties it left them in — whoever joined the fight on its own
// joins the roster too. The clock moves on by the ETs the table says the scene
// took, if any.
export function returnFromFight(ets: number): TableUpdater {
  return (table) => {
    if (getReturnBar(table.fight)) return table
    const campaign = giveBack(table, Object.values(table.fight.characters))
    return { campaign: passETs(ets)(campaign), fight: resetCombat(table.fight) }
  }
}

// Throws the fight away, whatever is being played out in it: whoever was sent
// from the roster goes back to it as the fight left them, and whoever was
// brought straight into the fight is gone. No time passes.
export const resetFight: TableUpdater = (table) => {
  const sent = Object.values(table.fight.characters).filter((c) => isFromRoster(table, c.id))
  return { campaign: giveBack(table, sent), fight: resetCombat(table.fight) }
}
