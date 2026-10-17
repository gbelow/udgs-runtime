import { create } from 'zustand'
import type { TrayThrow } from '../domain/play/calls'

// The throws waiting for the dice tray, in the order they were asked for: the
// one first is in the tray, and `land` is what its die answers once the dice
// are at rest. A throw asked for again while it waits is the same throw.
export type TrayRequest = { id: string; label: string; thrown: TrayThrow; land: () => void }

type TrayStore = {
  queue: TrayRequest[]
  ask: (request: TrayRequest) => void
  finish: (id: string) => void
}

export const useTrayStore = create<TrayStore>((set, get) => ({
  queue: [],
  ask: (request) => { if (!get().queue.some((r) => r.id === request.id)) set({ queue: [...get().queue, request] }) },
  finish: (id) => {
    const done = get().queue.find((r) => r.id === id)
    set({ queue: get().queue.filter((r) => r.id !== id) })
    done?.land()
  },
}))
