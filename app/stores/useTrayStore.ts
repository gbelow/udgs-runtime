import { create } from 'zustand'
import type { TrayThrow } from '../domain/play/calls'

// The throws waiting for the dice tray, in the order they were asked for: the
// one first is in the tray, and `land` is what its die answers once the dice
// are at rest.
export type TrayRequest = { id: string; label: string; thrown: TrayThrow; land: () => void }

type TrayStore = {
  queue: TrayRequest[]
  ask: (request: TrayRequest) => void
  finish: (id: string) => void
}

export const useTrayStore = create<TrayStore>((set, get) => ({
  queue: [],
  ask: (request) => set({ queue: [...get().queue.filter((r) => r.id !== request.id), request] }),
  finish: (id) => {
    const done = get().queue.find((r) => r.id === id)
    set({ queue: get().queue.filter((r) => r.id !== id) })
    done?.land()
  },
}))
