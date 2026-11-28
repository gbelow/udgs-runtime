import { create } from 'zustand'

// The active character's sheet as a window over the scene: the tab it is open
// at, or null while it is closed, and where it was dragged to, or null while
// it sits docked on the right, over the log.
type SheetWindowStore = {
  tab: string | null
  at: { x: number; y: number } | null
  setTab: (tab: string | null) => void
  setAt: (at: { x: number; y: number } | null) => void
}

export const useSheetWindowStore = create<SheetWindowStore>((set) => ({
  tab: null,
  at: null,
  setTab: (tab) => set({ tab }),
  setAt: (at) => set({ at }),
}))
