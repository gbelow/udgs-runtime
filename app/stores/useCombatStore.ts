// stores/useCombatStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { SceneState, SceneStateSchema } from '../domain/scene/types'
import { getActiveCharacter } from '../domain/scene/rules/fighters'
import { updateCharacter } from '../domain/scene/commands/characters'
import { holdForDice } from '../domain/play/calls'

// The data half of the store is the domain's SceneState — the store adds only
// the actions that mutate it. Keeping the two halves separate is what lets the
// combat commands be pure SceneState updaters with no import from here.
type CombatActions = {
  setActiveCharacter: (id: string) => void
  getActiveCharacter: () => CampaignCharacter | null

  updateActiveCharacter: (
    updater: (c: CampaignCharacter) => CampaignCharacter,
    cause?: string
  ) => CampaignCharacter | undefined

  updateCombatState: (updater: (state: SceneState) => SceneState) => void
}

export type CombatStore = SceneState & CombatActions

const called = (s: SceneState) => [s.calls]

export const useCombatStore = create<CombatStore>((set, get) => ({
  ...SceneStateSchema.parse({}),

  // whatever the scene called dice for waits on them (`holdForDice`)
  updateCombatState: (updater) => {
    set((s) => holdForDice(called, s, updater(s)))
  },

  setActiveCharacter: (id) => {
    set({ activeCharacterId: id })
  },

  getActiveCharacter: () => getActiveCharacter(get()),

  updateActiveCharacter: (updater, cause) => {
    const current = get().getActiveCharacter();
    if (!current) return undefined;
    set((s) => holdForDice(called, s, updateCharacter(current.id, updater, cause)(s)));
    return get().characters[current.id];
  },

}))
