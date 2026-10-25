import type { Action, SceneState, Coord } from '../types'
import { isRootAction } from './actionCatalog'
import { getDeclaredCellTargets } from './action'
import { getExplosionCenters, isAimable } from './explosion'
import { getExtinguishCells } from './extinguish'
import { getThrowCells } from './throw'
import { getPlantCells } from './plant'
import { getDisplacementCells, getPendingDisplacement } from './displace'

// Where the open action is waiting to be pointed on the board, and which of
// its fields a pick fills: an explosion's centre until its actor commits to
// it (a disk; a spray is pointed on its blast), a throw's landing once what
// is thrown is picked, the burning space to muffle, the cell a planted shield
// faces, the space of the ground a burning strike or shot is aimed at, the
// space a won crash puts its defender in. Null for anything else.
export type Aim = { cells: Coord[]; field: 'center' | 'to' | 'cell' | 'displace' }

export function getAim(state: SceneState, open: Action | null): Aim | null {
  const displaced = open?.kind === 'move' ? getPendingDisplacement(state, open) : null
  if (open?.kind === 'move' && displaced) return { cells: getDisplacementCells(state, open, displaced), field: 'displace' }
  if (open?.kind === 'explosion' && isAimable(state, open)) return { cells: getExplosionCenters(state, open), field: 'center' }
  if (open?.kind === 'throw' && open.step === 'define' && open.itemId) return { cells: getThrowCells(state, open.actorId, open.itemId), field: 'to' }
  if (open?.kind === 'extinguish' && open.step === 'define') return { cells: getExtinguishCells(state, open.actorId), field: 'to' }
  if (open?.kind === 'plant' && open.step === 'define') return { cells: getPlantCells(state, open.actorId), field: 'to' }
  const cells = open && isRootAction(open) ? getDeclaredCellTargets(state, open) : []
  return cells.length > 0 ? { cells, field: 'cell' } : null
}
