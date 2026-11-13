import { GearMoveSchema } from '../../types'
import type { SceneState, Updater } from '../types'
import { isCombatStarted } from '../rules/started'
import { declareAction } from './action'

// A press on the hands, containers or armor panels. Before the fight has
// started, and for the GM at any time, it is made at once (`made`). Once the
// fight has started a player's is a move with gear declared as an action of
// its own (`gear`), to be committed like any other; what is no move (a catalog
// pick) is refused.
export function pressGear(id: string, move: unknown, gm: boolean, made: Updater, newId: () => string): Updater {
  return (state) => {
    if (isDirectGearEdit(state, gm)) return made(state)
    const parsed = GearMoveSchema.safeParse(move)
    return parsed.success ? declareAction(id, { kind: 'gear', move: parsed.data }, newId)(state) : state
  }
}

// Whether a move with gear is made at once rather than declared.
export function isDirectGearEdit(state: SceneState, gm: boolean): boolean {
  return gm || !isCombatStarted(state)
}
