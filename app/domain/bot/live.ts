import type { SceneState } from '../scene/types'
import { getNextMove, type Move, type MoveOptions, type Seat } from './seat'

// The bots at a table that people play at too: what is done next, and when,
// for whoever sends it. It is asked again after every change to the fight.

// What is kept between one move and the next: the seat asked first, the moves pressed lately
// (`keyOf`), and the one the bots stopped at, if they have.
export type Live = { from: number; pressed: readonly string[]; stoppedAt: string | null }

export const NEW_LIVE: Live = { from: 0, pressed: [], stoppedAt: null }

// Nothing to do until the fight changes; a move to press; or the same move pressed too often in the same fight, which stops
// the bots until it changes (`first`, when they have only now).
export type LiveStep = { do: 'nothing' } | { do: 'press'; move: Move } | { do: 'stop'; move: Move; first: boolean }

// How many times a move may be pressed in the same fight, and how many of the
// last moves that is counted over, so that a bot pressing something that
// leads nowhere, or back and forth, does not spin.
export const REPEATS = 3
const LOOKED_BACK = 32

// A move and the fight it is pressed in, shortened. Of the fight, all but
// what only ever grows, which a move that leads nowhere may still add to: the
// log, but for what is in play, and the turns and time counted.
function keyOf(state: SceneState, move: Move): string {
  const inPlay = [...state.live, ...state.stack].map((id) => state.actions[id])
  const fight: SceneState = { ...state, actions: {}, landed: [], journal: [], edits: [], logSaved: 0, names: {}, elapsed: 0, turn: 0, turnsBegun: 0 }
  return shorten(JSON.stringify([move.by, move.who, move.commands, inPlay, fight]))
}

// cyrb53, a 53-bit hash of the text.
function shorten(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    a = Math.imul(a ^ ch, 2654435761)
    b = Math.imul(b ^ ch, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

export function getLiveStep(live: Live, state: SceneState, seats: readonly Seat[], opts: MoveOptions): { step: LiveStep; live: Live; refused: string[] } {
  const { move, next, refused } = getNextMove(state, seats, opts, live.from)
  if (!move) return { step: { do: 'nothing' }, live, refused }
  const asked = { ...live, from: next }
  const key = keyOf(state, move)
  if (live.pressed.filter((k) => k === key).length >= REPEATS) {
    return { step: { do: 'stop', move, first: live.stoppedAt !== key }, live: { ...asked, stoppedAt: key }, refused }
  }
  return { step: { do: 'press', move }, live: { ...asked, pressed: [...live.pressed, key].slice(-LOOKED_BACK), stoppedAt: null }, refused }
}
