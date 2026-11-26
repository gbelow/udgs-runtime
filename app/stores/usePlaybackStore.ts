import { create } from 'zustand'

// When the board on this screen will have played what it has been given (on
// the `performance.now()` clock), so that the bots press and the time to
// contest runs only once it has. Presentation only: never part of the fight,
// and nothing that plays without a screen reads it.
type PlaybackStore = {
  until: number
  setUntil: (until: number) => void
}

export const usePlaybackStore = create<PlaybackStore>((set) => ({
  until: 0,
  setUntil: (until) => set({ until }),
}))

// Whether the board is still playing.
export const isBoardPlaying = (): boolean => usePlaybackStore.getState().until > performance.now()
