import { create } from 'zustand'

// The active character's sheet as a window over the scene: whether it is
// open, and where it was dragged to, or null while it sits docked on the
// right, over the log.
type SheetWindowStore = {
  open: boolean
  at: { x: number; y: number } | null
  setOpen: (open: boolean) => void
  setAt: (at: { x: number; y: number } | null) => void
}

export const useSheetWindowStore = create<SheetWindowStore>((set) => ({
  open: false,
  at: null,
  setOpen: (open) => set({ open }),
  setAt: (at) => set({ at }),
}))
