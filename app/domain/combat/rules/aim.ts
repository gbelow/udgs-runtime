import type { Action, CombatState, Coord } from '../types'
import { getExplosionCenters, isAimable } from './explosion'
import { getThrowCells } from './throw'

// Where the open action is waiting to be pointed on the board, and which of
// its fields a pick fills: an explosion's centre until its actor commits to
// it (a disk; a spray is pointed on its blast), a throw's landing once what
// is thrown is picked. Null for anything else.
export type Aim = { cells: Coord[]; field: 'center' | 'to' }

export function getAim(state: CombatState, open: Action | null): Aim | null {
  if (open?.kind === 'explosion' && isAimable(state, open)) return { cells: getExplosionCenters(state, open), field: 'center' }
  if (open?.kind === 'throw' && open.step === 'define' && open.itemId) return { cells: getThrowCells(state, open.actorId, open.itemId), field: 'to' }
  return null
}
