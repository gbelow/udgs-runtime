import { create } from 'zustand'
import type { DemoPlay } from '../domain/demo'

// The demo on this screen.
type DemoStore = DemoPlay & {
  setPicks: (picks: string[]) => void
  play: (party: string) => void
  start: () => void
  back: () => void
}

export const useDemoStore = create<DemoStore>((set) => ({
  stage: 'pick',
  picks: [],
  party: '',
  started: false,
  setPicks: (picks) => set({ picks }),
  play: (party) => set({ stage: 'play', party, started: false }),
  start: () => set({ started: true }),
  back: () => set({ stage: 'pick', started: false }),
}))
