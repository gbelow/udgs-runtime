// stores/useCombatStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { CombatState, CombatStateSchema } from '../domain/combat/types'
import { getActiveCharacter } from '../domain/combat/rules/activeCharacter'
import { makeCampaignCharacter } from '../domain/factories'
import { addCharacterToCombat } from '../domain/combat/factories'
import { removeFromCombat, updateCharacter } from '../domain/combat/commands/characters'

// The data half of the store is the domain's CombatState — the store adds only
// the actions that mutate it. Keeping the two halves separate is what lets the
// combat commands be pure CombatState updaters with no import from here.
type CombatActions = {
  loadCharacter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  getActiveCharacter: () => CampaignCharacter | null

  updateActiveCharacter: (
    updater: (c: CampaignCharacter) => CampaignCharacter
  ) => CampaignCharacter | undefined

  removeCharacter: (id: string) => void

  updateCombatState: (updater: (state: CombatState) => CombatState) => void
}

export type CombatStore = CombatState & CombatActions

export const useCombatStore = create<CombatStore>((set, get) => ({
  ...CombatStateSchema.parse({}),

  updateCombatState: (updater) => {
    set( updater)
  },

  loadCharacter: (rawCharacter) =>
    set((s) => {
      const campaignCharacter = makeCampaignCharacter( rawCharacter)
      const added = addCharacterToCombat(campaignCharacter, s.characters, () => crypto.randomUUID())
      return({
        characters: {
          ...s.characters,
          [added.id]: added
        }
      })
    }),

  setActiveCharacter: (id) => {
    set({ activeCharacterId: id })
  },

  getActiveCharacter: () => getActiveCharacter(get()),

  updateActiveCharacter: (updater) => {
    const current = get().getActiveCharacter();
    if (!current) return undefined;
    set(updateCharacter(current.id, updater));
    return get().characters[current.id];
  },

  removeCharacter: (id) => set(removeFromCombat(id)),
}))
