// stores/useCombatStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { SceneState, SceneStateSchema } from '../domain/scene/types'
import { getActiveCharacter } from '../domain/scene/rules/fighters'
import { makeCampaignCharacter } from '../domain/factories'
import { withInstance } from '../domain/instances'
import { removeFromCombat, updateCharacter } from '../domain/scene/commands/characters'

// The data half of the store is the domain's SceneState — the store adds only
// the actions that mutate it. Keeping the two halves separate is what lets the
// combat commands be pure SceneState updaters with no import from here.
type CombatActions = {
  loadCharacter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  getActiveCharacter: () => CampaignCharacter | null

  updateActiveCharacter: (
    updater: (c: CampaignCharacter) => CampaignCharacter
  ) => CampaignCharacter | undefined

  removeCharacter: (id: string) => void

  updateCombatState: (updater: (state: SceneState) => SceneState) => void
}

export type CombatStore = SceneState & CombatActions

export const useCombatStore = create<CombatStore>((set, get) => ({
  ...SceneStateSchema.parse({}),

  updateCombatState: (updater) => {
    set( updater)
  },

  loadCharacter: (rawCharacter) =>
    set((s) => {
      return { characters: withInstance(makeCampaignCharacter(rawCharacter), s.characters, () => crypto.randomUUID()) }
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
