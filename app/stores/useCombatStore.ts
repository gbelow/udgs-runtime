// stores/useCombatStore.ts
import { create } from 'zustand'
import { CampaignCharacter } from '../domain/types'
import { CombatState } from '../domain/combat/types'
import { getActiveCharacter } from '../domain/combat/lenses/activeCharacter'
import { makeCampaignCharacter } from '../domain/factories'
import { addCharacterToCombat } from '../domain/utils'

// The data half of the store is the domain's CombatState — the store adds only
// the actions that mutate it. Keeping the two halves separate is what lets the
// combat commands be pure CombatState updaters with no import from here.
type CombatActions = {
  loadCharacter: (rawCharacter: unknown) => void
  setActiveCharacter: (id: string) => void
  getActiveCharacter: () => CampaignCharacter | null

  updateActiveCharacter: (
    updater: (c: CampaignCharacter) => CampaignCharacter
  ) => void

  removeCharacter: (id: string) => void

  updateCombatState: (updater: (state: CombatState) => CombatState) => void
}

export type CombatStore = CombatState & CombatActions

export const useCombatStore = create<CombatStore>((set, get) => ({ 
  characters: {},
  activeCharacterId: null,
  round: 0,
  inTurnCharacter: '',

  updateCombatState: (updater) => {
    set( updater)
  },

  loadCharacter: (rawCharacter) =>
    set((s) => {
      const campaignCharacter = makeCampaignCharacter( rawCharacter)
      return({
        characters: {
          ...s.characters,
          [String(campaignCharacter.id)]: addCharacterToCombat(campaignCharacter, s.characters)

        }
      })
    }),

  setActiveCharacter: (id) => {
    set({ activeCharacterId: id })
  },

  getActiveCharacter: () => getActiveCharacter(get()),

  updateActiveCharacter: (updater) => {
    const currentState = get();
    const current = currentState.getActiveCharacter();
    if (!current || !current.id) return undefined;
    
    const updated = updater(current);

    set({
      characters: {
        ...currentState.characters,
        [current.id]: updated
      }
    });

    return updated;
  },

  removeCharacter: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = s.characters
      return { characters: rest }
    })
}))
