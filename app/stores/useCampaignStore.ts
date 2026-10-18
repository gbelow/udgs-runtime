// stores/useCampaignStore.ts
import { create } from 'zustand'
import type { Selected } from '../domain/types'
import { CampaignState, CampaignStateSchema, CampaignUpdater } from '../domain/campaign/types'
import type { TableUpdater } from '../domain/scene/types'
import { ExplorationState, ExplorationStateSchema, ExplorationUpdater } from '../domain/exploration/types'
import { DowntimeState, DowntimeStateSchema, DowntimeUpdater } from '../domain/downtime/types'
import { makeCampaignCharacter } from '../domain/factories'
import { loadIntoFight } from '../domain/scene/commands/fight'
import { useCombatStore } from './useCombatStore'
import { newFile, type CampaignFileInfo, type CampaignInPlay } from '../domain/saves'
import type { CampaignMembers, CharacterOwners } from '../domain/profiles'
import { holdForDice } from '../domain/play/calls'

// The data half is the domain's CampaignState, as with the combat store: the
// roster out of any fight and the clock; beside it, what exploration and
// downtime keep.
// Moving characters between it and the fight is a domain command over both,
// landed on both stores by `updateTable`; an exploration command reads and
// writes the campaign and its own state together, landed by
// `updateExploration`, and a downtime command likewise by `updateDowntime`.
// Which saved campaign this is: the id it is saved under, its name, who
// plays it, and how it stands in storage.
export type CampaignFile = CampaignFileInfo

type CampaignActions = {
  setFileName: (name: string) => void
  setMembers: (members: CampaignMembers) => void
  // what the server says of the campaign after writing it
  setFile: (file: Partial<CampaignFile>) => void
  setOwner: (id: string, owner: string | null) => void
  // replaces the campaign in play, its fight with it
  openCampaign: (t: CampaignInPlay, file: CampaignFile, owners?: CharacterOwners) => void
  loadFighter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  updateCampaignState: (updater: CampaignUpdater) => void
  updateTable: (updater: TableUpdater) => void
  updateExploration: (updater: ExplorationUpdater) => void
  updateDowntime: (updater: DowntimeUpdater) => void
}

// `owners` is whose each player character was when the campaign was opened,
// read from their records, and whom the GM has given them to since; saved
// onto those records, never into the campaign.
export type CampaignStore = CampaignState & Selected & { exploration: ExplorationState; downtime: DowntimeState; file: CampaignFile; owners: CharacterOwners } & CampaignActions

// What exploration and downtime called dice for waits on them (`holdForDice`),
// and so does the scene, for whatever crosses into it.
const called = (s: { exploration: ExplorationState; downtime: DowntimeState }) => [s.exploration.calls, s.downtime.calls]

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...CampaignStateSchema.parse({}),
  activeCharacterId: null,
  exploration: ExplorationStateSchema.parse({}),
  downtime: DowntimeStateSchema.parse({}),
  file: newFile(crypto.randomUUID()),
  owners: {},

  setFileName: (name) => set((s) => ({ file: { ...s.file, name } })),
  setMembers: (members) => set((s) => ({ file: { ...s.file, members } })),
  setFile: (file) => set((s) => ({ file: { ...s.file, ...file } })),
  setOwner: (id, owner) => set((s) => ({ owners: { ...s.owners, [id]: owner } })),

  openCampaign: (t, file, owners = {}) => {
    set({ ...t.campaign, activeCharacterId: null, exploration: t.exploration, downtime: t.downtime, file, owners })
    useCombatStore.setState({ ...t.fight, activeCharacterId: null })
  },

  updateCampaignState: (updater) => set((s) => holdForDice(called, s, { ...s, ...updater(s) })),

  updateTable: (updater) => {
    const s = get()
    const before = useCombatStore.getState()
    const { campaign, fight } = updater({ campaign: s, fight: before })
    if (holdForDice(called, s, { ...s, ...campaign }) === s || (fight !== before && holdForDice((f) => [f.calls], before, fight) === before)) return
    set(campaign)
    useCombatStore.setState(fight)
  },

  updateExploration: (updater) => {
    const s = get()
    const { campaign, exploration } = updater({ campaign: s, exploration: s.exploration })
    set(holdForDice(called, s, { ...s, ...campaign, exploration }))
  },

  updateDowntime: (updater) => {
    const s = get()
    const { campaign, downtime } = updater({ campaign: s, downtime: s.downtime })
    set(holdForDice(called, s, { ...s, ...campaign, downtime }))
  },

  loadFighter: (rawCharacter) =>
    get().updateTable(loadIntoFight(makeCampaignCharacter(rawCharacter), () => crypto.randomUUID())),

  setActiveCharacter: (id) => set((s) => (s.characters[id] ? { activeCharacterId: id } : {})),
}))

// The campaign in play as a whole, out of both stores: what `openCampaign`
// lands in them.
export function getInPlay(): CampaignInPlay {
  const s = useCampaignStore.getState()
  return { campaign: s, exploration: s.exploration, downtime: s.downtime, fight: useCombatStore.getState() }
}

// Whoever leaves the roster is no longer picked.
useCampaignStore.subscribe((s) => {
  if (s.activeCharacterId && !s.characters[s.activeCharacterId]) useCampaignStore.setState({ activeCharacterId: null })
})
