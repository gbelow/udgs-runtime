// stores/useCampaignStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { CampaignState, CampaignStateSchema, CampaignUpdater } from '../domain/campaign/types'
import type { TableUpdater } from '../domain/scene/types'
import { ExplorationState, ExplorationStateSchema, ExplorationUpdater } from '../domain/exploration/types'
import { DowntimeState, DowntimeStateSchema, DowntimeUpdater } from '../domain/downtime/types'
import { makeCampaignCharacter } from '../domain/factories'
import { updateRosterCharacter, setRosterActive } from '../domain/campaign/commands/roster'
import { loadIntoFight, loadOntoRoster } from '../domain/scene/commands/fight'
import { useCombatStore } from './useCombatStore'
import { resetCombat } from '../domain/scene/commands/resetCombat'
import type { CampaignInPlay } from '../domain/saves'
import type { CampaignMembers, CharacterOwners } from '../domain/profiles'
import { holdForDice } from '../domain/play/calls'

// The data half is the domain's CampaignState, as with the combat store: the
// roster out of any fight and the clock; beside it, what exploration and
// downtime keep.
// Moving characters between it and the fight is a domain command over both,
// landed on both stores by `updateTable`; an exploration command reads and
// writes the campaign and its own state together, landed by
// `updateExploration`, and a downtime command likewise by `updateDowntime`.
// Which saved campaign this is: the id it is saved under, its name, and who
// plays it.
export type CampaignFile = { id: string; name: string; members: CampaignMembers }

type CampaignActions = {
  setFileName: (name: string) => void
  setMembers: (members: CampaignMembers) => void
  setOwner: (id: string, owner: string | null) => void
  // replaces the campaign in play, and throws away any fight
  openCampaign: (t: CampaignInPlay, file: CampaignFile, owners?: CharacterOwners) => void
  loadCharacter: (rawCharacter: unknown, into?: string) => void
  loadFighter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  updateActiveCharacter: (updater: (c: CampaignCharacter) => CampaignCharacter) => CampaignCharacter | undefined
  updateCampaignState: (updater: CampaignUpdater) => void
  updateTable: (updater: TableUpdater) => void
  updateExploration: (updater: ExplorationUpdater) => void
  updateDowntime: (updater: DowntimeUpdater) => void
}

// `owners` is whose each player character was when the campaign was opened,
// read from their records, and whom the GM has given them to since; saved
// onto those records, never into the campaign.
export type CampaignStore = CampaignState & { exploration: ExplorationState; downtime: DowntimeState; file: CampaignFile; owners: CharacterOwners } & CampaignActions

// What exploration and downtime called dice for waits on them (`holdForDice`),
// and so does the scene, for whatever crosses into it.
const called = (s: { exploration: ExplorationState; downtime: DowntimeState }) => [s.exploration.calls, s.downtime.calls]

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...CampaignStateSchema.parse({}),
  exploration: ExplorationStateSchema.parse({}),
  downtime: DowntimeStateSchema.parse({}),
  file: { id: crypto.randomUUID(), name: '', members: {} },
  owners: {},

  setFileName: (name) => set((s) => ({ file: { ...s.file, name } })),
  setMembers: (members) => set((s) => ({ file: { ...s.file, members } })),
  setOwner: (id, owner) => set((s) => ({ owners: { ...s.owners, [id]: owner } })),

  openCampaign: (t, file, owners = {}) => {
    set({ ...t.campaign, exploration: t.exploration, downtime: t.downtime, file, owners })
    useCombatStore.setState(resetCombat(useCombatStore.getState()))
  },

  updateCampaignState: (updater) => set((s) => holdForDice(called, s, { ...s, ...updater(s) })),

  updateTable: (updater) => {
    const s = get()
    const before = useCombatStore.getState()
    const { campaign, fight } = updater({ campaign: s, fight: before })
    if (holdForDice(called, s, { ...s, ...campaign }) === s || holdForDice((f) => [f.calls], before, fight) === before) return
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

  loadCharacter: (rawCharacter, into) =>
    get().updateTable(loadOntoRoster(makeCampaignCharacter(rawCharacter), () => crypto.randomUUID(), into)),

  loadFighter: (rawCharacter) =>
    get().updateTable(loadIntoFight(makeCampaignCharacter(rawCharacter), () => crypto.randomUUID())),

  setActiveCharacter: (id) => set(setRosterActive(id)),

  updateActiveCharacter: (updater) => {
    const id = get().activeCharacterId
    if (!id) return undefined
    set((s) => holdForDice(called, s, { ...s, ...updateRosterCharacter(id, updater)(s) }))
    return get().characters[id]
  },
}))
