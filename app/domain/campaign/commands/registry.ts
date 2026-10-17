import type { Actor } from '../../profiles'
import { commandsOver, playedBy, type CommandOf } from '../../registry'
import type { Dice } from '../../play/dice'
import type { CampaignCharacter } from '../../types'
import { toCharacterUpdater, type CharacterCommand, type GearCommand } from '../../character/commands/registry'
import type { At, CampaignState } from '../types'
import { passTimeTo, placeOnTimeline, setDayETs, setPartyActive } from './clock'
import { editNote, removeEntry, writeNote } from './journal'
import { toMapUpdater, type MapCommand } from './mapRegistry'
import { addMap, createParty, leaveParty, mergeParties, moveToParty, removeMap, renameParty, setPartyExposure, setPartyLit, setPartyPlace, splitOff, updateCampaignMap } from './parties'
import { updateRosterCharacter } from './roster'

// The campaign's presses as data (cf. the scene's registry): the parties,
// the clocks, the maps, the journal, and an edit to a character on the
// roster. The dice and the ids are the table's.

export type CampaignContext = { newId: () => string; dice: Dice }

const command = commandsOver<CampaignState, CampaignContext>()
const gm = (): Actor => 'gm'
const own = (_: CampaignState, id: string): Actor => ({ id })
const authorOf = (state: CampaignState, id: string): Actor => ({ author: state.journal.find((e) => e.id === id)?.author ?? null })

export const campaignCommands = {
  // the parties, out of a fight: a player moves only their own character
  createParty: command((ctx, name: string) => createParty(ctx.newId(), name)).by(gm),
  renameParty: command((_, partyId: string, name: string) => renameParty(partyId, name)).by(gm),
  moveToParty: command((_, id: string, partyId: string) => moveToParty(id, partyId)).by(own),
  splitOff: command((ctx, id: string) => splitOff(id, ctx.newId)).by(own),
  leaveParty: command((_, id: string) => leaveParty(id)).by(own),
  mergeParties: command((_, fromId: string, intoId: string) => mergeParties(fromId, intoId)).by(gm),
  setPartyExposure: command((_, partyId: string, exposure: number) => setPartyExposure(partyId, exposure)).by(gm),
  setPartyLit: command((_, partyId: string, lit: boolean) => setPartyLit(partyId, lit)).by(gm),
  setPartyPlace: command((_, partyId: string, at: At | null) => setPartyPlace(partyId, at)).by(gm),

  // the clocks
  setDayETs: command((_, dayETs: number) => setDayETs(dayETs)).by(gm),
  setPartyActive: command((_, partyId: string, active: boolean) => setPartyActive(partyId, active)).by(gm),
  placeOnTimeline: command((_, partyId: string, clock: number) => placeOnTimeline(partyId, clock)).by(gm),
  passTimeTo: command((_, partyId: string, clock: number) => passTimeTo(partyId, clock)).by(gm),

  // the campaign's own maps, each a copy of one from the catalog
  addMap: command((ctx, template: unknown) => addMap(ctx.newId(), template)).by(gm),
  removeMap: command((_, mapId: string) => removeMap(mapId)).by(gm),
  editMap: command((ctx, mapId: string, edit: MapCommand) => updateCampaignMap(mapId, toMapUpdater(edit, ctx))).by(gm),

  // the journal: a note is its writer's, or the GM's, to change
  writeNote: command((_, party: string | null, text: string, gmOnly: boolean, author: string | null) => writeNote(party, text, gmOnly, author))
    .by((_, _party, _text, _gmOnly, author) => ({ author })),
  editNote: command((_, id: string, text: string, gmOnly: boolean) => editNote(id, text, gmOnly)).by(authorOf),
  removeEntry: command((_, id: string) => removeEntry(id)).by(authorOf),

  // an edit to a character on the roster, by whoever plays them
  edit: command((ctx, id: string, edit: CharacterCommand | GearCommand) =>
    updateRosterCharacter(id, toCharacterUpdater(edit, ctx) as (c: CampaignCharacter) => CampaignCharacter)).by(own),
}

export type CampaignCommand = CommandOf<typeof campaignCommands>

export const { barOf: getCampaignCommandBar, toUpdater: toCampaignUpdater } = playedBy<CampaignState, CampaignContext, typeof campaignCommands>(campaignCommands)
