// stores/useCharacterStore.ts
import { create } from 'zustand'
import { Character } from '../domain/types'
import { makeCharacter } from '../domain/factories'

type CharacterStore = {
  character:  Character | null

  loadCharacter: (rawCharacter: unknown) => void

  updateCharacter: (
    updater: (c: Character) => Character
  ) => void

  removeCharacter: (id: string) => void
}

export const useCharacterStore = create<CharacterStore>((set) => ({ 
  character: null,

  loadCharacter: (rawCharacter) => {
    const character = makeCharacter(rawCharacter)
     
    // const {afflictions, injuries, hasActionSurge, fightName, resources, id, ...char } = character
    set(() => ({
        character: {...character}
      }
    ))
  },


  updateCharacter: ( updater) =>
    set((s) => {
      const current = s.character
      if (!current) return s
      const updated = updater(current)

      return {
        character: updated,
        }
      }
    ),
  
  removeCharacter: () =>
    set(() => {
      return { character: null }
    }),

}))
