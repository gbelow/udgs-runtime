import type { Dice } from '../play/dice'
import { toUpdater, type SceneCommand } from '../scene/commands/registry'
import type { SceneState } from '../scene/types'

// A bot's move: the scene commands it presses, in order, as a person at the
// table would press them, so that it can be sent to wherever the fight is
// played. While it weighs a move it keeps the state the move came to.
export type Move = SceneCommand[]
export type Played = { move: Move; state: SceneState }

export function applyMove(state: SceneState, move: Move, dice: Dice, newId: () => string): SceneState {
  return move.reduce((s, command) => toUpdater(command, { thrower: dice, newId })(s), state)
}

// The move pressed on `state`, with the state it comes to.
export function play(state: SceneState, move: Move, dice: Dice, newId: () => string): Played {
  return { move, state: applyMove(state, move, dice, newId) }
}

// One move after another, as one.
export function andThen(first: Played, next: Played): Played {
  return { move: [...first.move, ...next.move], state: next.state }
}

// The move when it changes anything, else null.
export function ifChanged(before: SceneState, played: Played): Played | null {
  return played.state !== before ? played : null
}
