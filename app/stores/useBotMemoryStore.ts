import { create } from 'zustand'
import { apply, type Patch } from '../net/diff'
import { SeatMemoriesSchema, type SeatMemories } from '../domain/bot/memory'

// What the bots of the fight on this screen remember, as their thread last
// said, for the browser to keep beside the fight and bring back with it.
// `restored` counts the times it was put in place from elsewhere, for the
// thread to take it up.
type BotMemoryStore = {
  memories: SeatMemories
  restored: number
  patch: (changed: Patch) => void
  // as it was kept; nothing where nothing was, or it no longer reads
  restore: (kept?: unknown) => void
}

export const useBotMemoryStore = create<BotMemoryStore>((set) => ({
  memories: {},
  restored: 0,
  patch: (changed) => set((s) => ({ memories: apply(s.memories, changed) as SeatMemories })),
  restore: (kept) => set((s) => {
    const read = SeatMemoriesSchema.safeParse(kept)
    return { memories: read.success ? read.data : {}, restored: s.restored + 1 }
  }),
}))
