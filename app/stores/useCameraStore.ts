import { create } from 'zustand'

// Whom this screen last asked its board's camera to look at, numbered so that
// asking for the same character again is asked again, and where on the screen
// the board drawn now shows a character (`where`, the board's own while one
// is drawn). A per-viewer convenience, never part of the fight.
export type ScreenSpot = { x: number; y: number; radius: number }
type CameraStore = {
  asked: { id: string; n: number } | null
  ask: (id: string) => void
  where: ((id: string) => ScreenSpot | null) | null
  setWhere: (where: ((id: string) => ScreenSpot | null) | null) => void
}

export const useCameraStore = create<CameraStore>((set) => ({
  asked: null,
  ask: (id) => set((s) => ({ asked: { id, n: (s.asked?.n ?? 0) + 1 } })),
  where: null,
  setWhere: (where) => set({ where }),
}))
