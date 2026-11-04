import { create } from 'zustand'

// Whether the next click on a token or on the roster picks whom the active
// character follows, instead of switching the active character.
type FollowPickStore = {
  picking: boolean
  setPicking: (picking: boolean) => void
}

export const useFollowPickStore = create<FollowPickStore>((set) => ({
  picking: false,
  setPicking: (picking) => set({ picking }),
}))
