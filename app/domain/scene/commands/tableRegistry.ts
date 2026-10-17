import type { Actor } from '../../profiles'
import { commandsOver, playedBy, type CommandOf } from '../../registry'
import type { CampaignCharacter } from '../../types'
import type { Table } from '../types'
import { loadIntoFight, removeFromFight, resetFight, returnFromFight, returnPartyFromFight, saveFightLog, sendPartyToFight, sendToFight, toggleBreakage } from './fight'

// What crosses between the campaign and the fight, as data (cf. the scene's
// own registry): characters sent in and brought back, brought straight in
// from a catalog under an id the campaign lends, taken out, and the fight
// thrown away.

export type TableContext = { newId: () => string }

const command = commandsOver<Table, TableContext>()
const gm = (): Actor => 'gm'

export const tableCommands = {
  sendToFight: command((_, ids: string[]) => sendToFight(ids)).by(gm),
  sendPartyToFight: command((_, partyId: string) => sendPartyToFight(partyId)).by(gm),
  returnFromFight: command((_, ids: string[], ets: number) => returnFromFight(ids, ets)).by(gm),
  returnPartyFromFight: command((_, partyId: string, ets: number) => returnPartyFromFight(partyId, ets)).by(gm),
  saveFightLog: command(() => saveFightLog).by(gm),
  loadIntoFight: command((ctx, character: CampaignCharacter, into?: string) => loadIntoFight(character, ctx.newId, into)).by(gm),
  removeFromFight: command((_, id: string) => removeFromFight(id)).by(gm),
  resetFight: command(() => resetFight).by(gm),
  toggleBreakage: command(() => toggleBreakage).by(gm),
}

export type TableCommand = CommandOf<typeof tableCommands>

export const { barOf: getTableCommandBar, toUpdater: toTableUpdater } = playedBy<Table, TableContext, typeof tableCommands>(tableCommands)
