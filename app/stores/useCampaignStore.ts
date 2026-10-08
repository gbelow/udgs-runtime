// stores/useCampaignStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { CampaignState, CampaignStateSchema, CampaignUpdater, TableUpdater } from '../domain/campaign/types'
import { makeCampaignCharacter } from '../domain/factories'
import { addToRoster, updateRosterCharacter, setRosterActive } from '../domain/campaign/commands/roster'
import { useCombatStore } from './useCombatStore'

// The data half is the domain's CampaignState, as with the combat store: the
// roster out of any fight and the clock. Moving characters between it and the
// fight is a domain command over both, landed on both stores by `updateTable`.
type CampaignActions = {
  loadCharacter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  updateActiveCharacter: (updater: (c: CampaignCharacter) => CampaignCharacter) => CampaignCharacter | undefined
  updateCampaignState: (updater: CampaignUpdater) => void
  updateTable: (updater: TableUpdater) => void
}

export type CampaignStore = CampaignState & CampaignActions

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  ...CampaignStateSchema.parse({}),

  updateCampaignState: (updater) => set(updater),

  updateTable: (updater) => {
    const { campaign, fight } = updater({ campaign: get(), fight: useCombatStore.getState() })
    set(campaign)
    useCombatStore.setState(fight)
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
