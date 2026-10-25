import type { Coord, Updater } from '../types'
import { makeAction } from '../factories'
import { getOpenAction } from '../rules/log'
import { getExplosionEffect, type ExplosionDraft } from '../rules/impose'
import { coordKey, distance } from '../rules/board/geometry'
import { appendActions } from './log'

// The GM's hand: sets an explosion off at a cell of the board. Nobody set it
// off, so it has no producer: it is the effect described, in a disk of the
// radius given, and the DL its reflexes are rolled against. Opened committed,
// for everyone it reaches to answer. Refused with no board, off the board, in
// a wall, or while an action is open, as painting is.
export function setOffExplosion(draft: ExplosionDraft, cell: Coord, newId: () => string): Updater {
  return (state) => {
    const board = state.board
    const effect = getExplosionEffect(draft)
    if (!board || !effect || getOpenAction(state) || distance(board.origin, cell) > board.radius) return state
    if (board.terrain[coordKey(cell)]?.blocking) return state
    return appendActions(state, [makeAction('explosion', { id: newId(), actorId: '', source: 'gm', dl: draft.DL, effects: [effect], center: cell, step: 'react' })])
  }
}
