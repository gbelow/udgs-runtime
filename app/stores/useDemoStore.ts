import { create } from 'zustand'
import type { DemoHint, DemoPlay, DemoSide } from '../domain/demo'

// The demo on this screen.
type DemoStore = DemoPlay & {
  setSides: (sides: DemoSide[]) => void
  play: (party: string) => void
  start: () => void
  back: () => void
  seeHint: (hint: DemoHint) => void
}

export const useDemoStore = create<DemoStore>((set) => ({
  stage: 'pick',
  sides: [],
  party: '',
  started: false,
  seen: [],
  setSides: (sides) => set({ sides }),
  play: (party) => set({ stage: 'play', party, started: false }),
  start: () => set({ started: true }),
  back: () => set({ stage: 'pick', started: false }),
  seeHint: (hint) => set((s) => ({ seen: [...s.seen.filter((h) => h !== hint), hint] })),
}))
