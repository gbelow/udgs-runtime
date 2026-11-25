import { create } from 'zustand'
import { NO_SIGHTS, type SightMemory } from '../domain/scene/projections/sights'

// What whoever is at the screen knows of the fight, when they play at it as a
// player (`player`): the characters they answer for, what those have sensed,
// and whom they know to be in it; the last of theirs they picked, whose eyes
// they look through; and for a GM, whether the board is seen through the eyes
// of whoever is picked.
type SightStore = {
  player: boolean
  own: readonly string[]
  memory: SightMemory
  known: readonly string[]
  last: string | null
  eyes: boolean
  setEyes: (eyes: boolean) => void
}

export const useSightStore = create<SightStore>((set) => ({
  player: false,
  own: [],
  memory: NO_SIGHTS,
  known: [],
  last: null,
  eyes: false,
  setEyes: (eyes) => set({ eyes }),
}))
