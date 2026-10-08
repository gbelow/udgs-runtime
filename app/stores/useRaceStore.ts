import { create } from 'zustand'
import { Character } from '../domain/types'
import { makeRaceHolder } from '../domain/factories'

// The race tab is a race *creator*: the race being made is held as a
// character carrying the race's traits, so the creature's editors work on it
// as they do on any character. There is always one to edit.
type RaceStore = {
  race: Character

  loadRace: (rawRace: unknown) => void

  updateRace: (
    updater: (c: Character) => Character
  ) => Character

  newRace: () => void
}

export const useRaceStore = create<RaceStore>((set, get) => ({
  race: makeRaceHolder(),

  loadRace: (rawRace) => set({ race: makeRaceHolder(rawRace) }),

  updateRace: (updater) => {
    const updated = updater(get().race)
    set({ race: updated })
    return updated
  },

  newRace: () => set({ race: makeRaceHolder() }),
}))
