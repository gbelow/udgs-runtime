// stores/useCombatStore.ts
import { create } from 'zustand'
import { CampaignCharacter, Selected } from '../domain/types'
import { SceneState, SceneStateSchema } from '../domain/scene/types'
import { getActiveCharacter } from '../domain/scene/rules/fighters'
import { updateCharacter } from '../domain/scene/commands/characters'
import { holdForDice } from '../domain/play/calls'

// The data half of the store is the domain's SceneState — the store adds only
// whom this screen has picked, which the table never shares, and the actions
// that mutate it. Keeping the halves separate is what lets the combat commands
// be pure SceneState updaters with no import from here.
type CombatActions = {
  setActiveCharacter: (id: string) => void
  getActiveCharacter: () => CampaignCharacter | null

  updateActiveCharacter: (
    updater: (c: CampaignCharacter) => CampaignCharacter,
    cause?: string
  ) => CampaignCharacter | undefined

  updateCombatState: (updater: (state: SceneState) => SceneState) => void
}

export type CombatStore = SceneState & Selected & CombatActions

const called = (s: SceneState) => [s.calls]

export const useCombatStore = create<CombatStore>((set, get) => ({
  ...SceneStateSchema.parse({}),
  activeCharacterId: null,

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

// Whoever leaves the fight is no longer picked.
useCombatStore.subscribe((s) => {
  if (s.activeCharacterId && !s.characters[s.activeCharacterId]) useCombatStore.setState({ activeCharacterId: null })
})
