import { create } from 'zustand'

// What the bots played on this screen and why, newest first, for the log to
// show beside the fight's: each move with the round it was made in, the
// character it was for and the bot's reason, or why the table refused it.
// Kept on the screen that plays the bots only, and never saved; beside it,
// whether the GM has paused the bots there, to play their characters by hand.
export type BotLogEntry = { round: number; who: string; why: string; refused: string | null }

const KEPT = 60

export const useBotLogStore = create<{ entries: BotLogEntry[]; add: (e: BotLogEntry) => void; paused: boolean; setPaused: (paused: boolean) => void }>((set) => ({
  entries: [],
  add: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, KEPT) })),
  paused: false,
  setPaused: (paused) => set({ paused }),
}))
