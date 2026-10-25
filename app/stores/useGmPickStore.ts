import { create } from 'zustand'

// Whom the GM has picked for a test by clicking them, in the top bar, on a
// card or on the board. While picking, those clicks choose instead of
// switching the active character.
type GmPickStore = {
  picking: boolean
  picked: string[]
  setPicking: (picking: boolean) => void
  setPicked: (picked: string[]) => void
  toggle: (id: string) => void
}

export const useGmPickStore = create<GmPickStore>((set) => ({
  picking: false,
  picked: [],
  setPicking: (picking) => set({ picking }),
  setPicked: (picked) => set({ picked }),
  toggle: (id) => set((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((p) => p !== id) : [...s.picked, id] })),
}))
