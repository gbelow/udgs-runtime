import { create } from 'zustand'
import type { BotControl } from '../domain/bot/pause'

// What the bots played on this screen and why, newest first, for the log to
// show beside the fight's: each move with the round it was made in, the
// character it was for and the bot's reason, or why the table refused it.
// Kept on the screen that plays the bots only, and never saved; beside it,
// the bots' pause (`BotControl`), a guest's as its host sends it. Whether the
// pause is open to the table is the host's setting, remembered in its browser.
export type BotLogEntry = { round: number; who: string; why: string; refused: string | null }

const KEPT = 60
const KEY = 'chargenfallow.botPauseOpen'

type BotLogStore = BotControl & {
  entries: BotLogEntry[]
  add: (e: BotLogEntry) => void
  setPaused: (paused: boolean) => void
  setOpen: (open: boolean) => void
  // the setting as this browser remembers it
  recall: () => void
}

export const useBotLogStore = create<BotLogStore>((set) => ({
  entries: [],
  add: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, KEPT) })),
  paused: false,
  setPaused: (paused) => set({ paused }),
  open: true,
  setOpen: (open) => {
    set({ open })
    try {
      window.localStorage.setItem(KEY, String(open))
    } catch {
      // the setting just is not remembered
    }
  },
  recall: () => {
    try {
      set({ open: window.localStorage.getItem(KEY) !== 'false' })
    } catch {
      // the setting stays as it is
    }
  },
}))
