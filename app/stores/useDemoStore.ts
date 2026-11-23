import { create } from 'zustand'

// The demo on this screen: the characters the visitor picked, by catalog
// key, whether they are picking or playing, the fight party that is theirs,
// and whether they said the fight may begin. Never saved.
type DemoStore = {
  stage: 'pick' | 'play'
  picks: string[]
  party: string
  started: boolean
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
