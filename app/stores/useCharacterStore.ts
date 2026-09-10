// stores/useCharacterStore.ts
import { create } from 'zustand'
import { Character } from '../domain/types'
import { makeCharacter } from '../domain/factories'


// The edit tab is a character *creator*: there is always something to edit, so
// the store holds a blank character rather than null and `removeCharacter`
// resets to a fresh one. Nothing downstream has to carry a "no character yet"
// branch.
type CharacterStore = {
  character: Character

  loadCharacter: (rawCharacter: unknown) => void

  updateCharacter: (
    updater: (c: Character) => Character
  ) => Character

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
    const updated = updater(get().character);

    set({ character: updated });

    return updated;
  },

  removeCharacter: () =>
    set(() => {
      return { character: makeCharacter(null) }
    }),

}))
