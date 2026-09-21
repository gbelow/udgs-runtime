import type { Board, CombatState } from '../domain/combat/types'

// What crosses between the app and a VTT, in game units. The board is the
// domain's own: placements keyed by character id, terrain keyed by axial
// cell, one cell one metre, pointy-top hexes. The roster is there so a VTT
// can map its tokens to character ids by name. Either side ingests the
// other's board through `makeBoard`, which drops whatever it cannot read,
// so a snapshot is never wrong, only incomplete.
export const SNAPSHOT_VERSION = 1

export type BoardSnapshot = {
  version: typeof SNAPSHOT_VERSION
  board: Board
  roster: { id: string; name: string }[]
  // who wrote it and when, so each side can tell its own echo from news
  source: 'app' | 'vtt'
  updatedAt: number
}

export function toSnapshot(state: CombatState, board: Board): BoardSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    board,
    roster: Object.values(state.characters).map((c) => ({ id: c.id, name: c.fightName ?? c.name })),
    source: 'app',
    updatedAt: Date.now(),
  }
}

// A snapshot as far as the app needs to trust it: an object carrying a
// `board`. Everything inside the board is the domain's to read.
export function isSnapshot(raw: unknown): raw is { board: unknown; source?: unknown; updatedAt?: unknown } {
  return raw !== null && typeof raw === 'object' && 'board' in raw
}

// A fight id names a mailbox; it goes into a storage key and a URL, so it
// is kept to a short, plain token.
export function isFightId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
}
