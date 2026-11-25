import { create } from 'zustand'
import type { DemoHint, DemoPlay } from '../domain/demo'

// The demo on this screen.
type DemoStore = DemoPlay & {
  setPicks: (picks: string[]) => void
  play: (party: string) => void
  start: () => void
  back: () => void
  seeHint: (hint: DemoHint) => void
}

export const useDemoStore = create<DemoStore>((set) => ({
  stage: 'pick',
  picks: [],
  party: '',
  started: false,
  seen: [],
  setPicks: (picks) => set({ picks }),
  play: (party) => set({ stage: 'play', party, started: false }),
  start: () => set({ started: true }),
  back: () => set({ stage: 'pick', started: false }),
  seeHint: (hint) => set((s) => ({ seen: [...s.seen.filter((h) => h !== hint), hint] })),
}))
