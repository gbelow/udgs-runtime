import type { Actor, CharacterOwners } from '../../profiles'
import { getSceneActor, getScenePlayers } from '../../campaign/rules/scenes'
import { commandsOver, playedBy, type CommandOf } from '../../registry'
import type { CampaignCharacter } from '../../types'
import type { Table } from '../types'
import { playScene } from './episode'
import { endScene, loadIntoFight, removeFromFight, removePartyFromFight, resetFight, returnFromFight, returnPartyFromFight, saveFightLog, sendPartyToFight, sendToFight, toggleBreakage } from './fight'

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
  endScene: command((_, keep: string[], ets: number) => endScene(keep, ets)).by(gm),
  removePartyFromFight: command((_, partyId: string) => removePartyFromFight(partyId)).by(gm),
  toggleBreakage: command(() => toggleBreakage).by(gm),
  // a prepared scene an event led to, played by anyone who met it
  playScene: command((ctx, sceneId: string, board: unknown | null, sheets: Record<string, unknown>) => playScene(sceneId, board, sheets, ctx.newId))
    .by((table, sceneId) => getSceneActor(table.campaign.scenes[sceneId]?.members ?? [])),
}

export type TableCommand = CommandOf<typeof tableCommands>

// Who plays the characters a command brings into the fight, read off the
// table before it is played: those a prepared scene brings in are played as
// it says. Whom each character is given to is kept beside the campaign, not
// in it, so the screen that plays the command lands this beside it.
export function getTableCommandOwners(table: Table, command: TableCommand): CharacterOwners {
  return command.kind === 'playScene' ? getScenePlayers(table.campaign, command.args[0]) : {}
}

export const { barOf: getTableCommandBar, toUpdater: toTableUpdater } = playedBy<Table, TableContext, typeof tableCommands>(tableCommands)
