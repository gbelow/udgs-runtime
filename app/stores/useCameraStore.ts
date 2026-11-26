import { create } from 'zustand'

// Whom this screen last asked its board's camera to look at, numbered so that
// asking for the same character again is asked again. A per-viewer
// convenience, never part of the fight.
type CameraStore = {
  asked: { id: string; n: number } | null
  ask: (id: string) => void
}

export const useCameraStore = create<CameraStore>((set) => ({
  asked: null,
  ask: (id) => set((s) => ({ asked: { id, n: (s.asked?.n ?? 0) + 1 } })),
}))
