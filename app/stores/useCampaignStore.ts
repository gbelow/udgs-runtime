// stores/useCampaignStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { CampaignState, CampaignStateSchema, CampaignUpdater, TableUpdater } from '../domain/campaign/types'
import { ExplorationState, ExplorationStateSchema, ExplorationUpdater } from '../domain/exploration/types'
import { makeCampaignCharacter } from '../domain/factories'
import { addToRoster, updateRosterCharacter, setRosterActive } from '../domain/campaign/commands/roster'
import { useCombatStore } from './useCombatStore'

// The data half is the domain's CampaignState, as with the combat store: the
// roster out of any fight and the clock; beside it, what exploration keeps.
// Moving characters between it and the fight is a domain command over both,
// landed on both stores by `updateTable`; an exploration command reads and
// writes the campaign and its own state together, landed by
// `updateExploration`.
type CampaignActions = {
  loadCharacter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  updateActiveCharacter: (updater: (c: CampaignCharacter) => CampaignCharacter) => CampaignCharacter | undefined
  updateCampaignState: (updater: CampaignUpdater) => void
  updateTable: (updater: TableUpdater) => void
  updateExploration: (updater: ExplorationUpdater) => void
}

export type CampaignStore = CampaignState & { exploration: ExplorationState } & CampaignActions

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...CampaignStateSchema.parse({}),
  exploration: ExplorationStateSchema.parse({}),

  updateCampaignState: (updater) => set(updater),

  updateTable: (updater) => {
    const { campaign, fight } = updater({ campaign: get(), fight: useCombatStore.getState() })
    set(campaign)
    useCombatStore.setState(fight)
  },

  updateExploration: (updater) => {
    const s = get()
    const { campaign, exploration } = updater({ campaign: s, exploration: s.exploration })
    set({ ...campaign, exploration })
  },

  loadCharacter: (rawCharacter) =>
    set(addToRoster(makeCampaignCharacter(rawCharacter), () => crypto.randomUUID())),

  setActiveCharacter: (id) => set(setRosterActive(id)),

  updateActiveCharacter: (updater) => {
    const id = get().activeCharacterId
    if (!id) return undefined
    set(updateRosterCharacter(id, updater))
    return get().characters[id]
  },
}))
