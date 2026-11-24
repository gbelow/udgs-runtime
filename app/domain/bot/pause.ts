import { getActorBar, type Viewer } from '../profiles'

// The bots' pause, kept by the screen that plays them and shared with the
// table: whether they make no move, and whether anyone at the table may pause
// them and start them again (the space bar over the board), or the GM alone.
export type BotControl = { paused: boolean; open: boolean }

// Why `viewer` may not pause the bots or start them again, or null when they may.
export const getPauseBar = (open: boolean, viewer: Viewer): string | null => (open ? null : getActorBar('gm', viewer))
