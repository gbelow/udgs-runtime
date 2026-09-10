// stores/useCharacterStore.ts
import { create } from 'zustand'
import { Character } from '../domain/types'
import { makeCharacter } from '../domain/factories'


type CharacterStore = {
  character:  Character | null

  loadCharacter: (rawCharacter: unknown) => void

  updateCharacter: (
    updater: (c: Character) => Character
  ) => Character | undefined

  removeCharacter: () => void
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({ 
  character: makeCharacter(null),

  loadCharacter: (rawCharacter) => {
    const character = makeCharacter(rawCharacter)
     
    set(() => ({
        character: {...character}
      }
    ))
  },

  updateCharacter: (updater) => {
    const current = get().character;
    
    if (!current) return undefined;

    const updated = updater(current);

    set({ character: updated });

    return updated;
  },
  
  removeCharacter: () =>
    set(() => {
      return { character: null }
    }),

}))
