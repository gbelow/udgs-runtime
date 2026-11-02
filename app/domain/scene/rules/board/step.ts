import type { MoveKind } from '../../../types'
import type { SceneState, Coord, Placement } from '../../types'
import { sameCell } from './geometry'
import { getFootprint } from './board'
import { crossesThinWall, isCrossable, isFootprintOpen, readGround, type Floor } from './ground'
import { canStepOver } from './cliff'
import { touchesGround } from './waypoint'

// Where a body may be and how it may get there, one step at a time: what
// every way of crossing the board asks of the ground, whoever moves the body
// (its own move, a jump out of a blow's way, a push or a drag, a crash that
// puts it aside). Each way says only which steps it takes; what each step
// asks is here, and where it may come to rest is `mayRestOn` (ground.ts).

// How a step is taken: by a movement of the body's own, or carried, as a
// push, a drag or a crash takes it, which keeps no rule of a movement's own
// (where it may fall from is the carrier's to say). `lands` the step it comes
// to rest on, `fromWater` the step before it was wet, and a jump clears
// nothing higher than `ceiling`.
export type Stepping = { movement: MoveKind | 'carried'; lands: boolean; fromWater: boolean; ceiling: number }

// May step: the body, which covers `footprint` once its anchor goes from
// `from` to `to`, a neighbour or the same cell, may take that step on the
// floor. A jump clears what it passes over; the cells it touches are dry or
// wet as the movement goes (`isCrossable`), the ones a jump only passes over
// just open; no thin wall stands across the step for any of its cells; and a
// walk crosses no cliff (`canStepOver`), a climb being the way over one.
export function mayStep(footprint: Coord[], floor: Floor, from: Coord, to: Coord, how: Stepping): boolean {
  const { movement } = how
  if (movement === 'jump' && !footprint.every((cell) => floor.elevation(cell) <= how.ceiling)) return false
  const touches = movement === 'carried' || touchesGround(movement, how.lands)
  if (!(touches ? isCrossable(footprint, floor, movement === 'carried' ? 'basic' : movement, how.fromWater) : isFootprintOpen(footprint, floor))) return false
  if (!sameCell(from, to) && crossesThinWall(footprint, floor, from, to)) return false
  return movement === 'climb' || movement === 'carried' || canStepOver(movement, floor.elevation(from), floor.elevation(to))
}

// A step a push, a drag or a crash carries a body.
export const CARRIED: Stepping = { movement: 'carried', lands: true, fromWater: false, ceiling: Infinity }

// May the character be carried from one placement to the next, on the floor
// they set out from.
export function mayBeCarried(state: SceneState, id: string, from: Placement, to: Placement): boolean {
  const c = state.characters[id]
  const floor = readGround(state, id)?.at(from.elevation)
  return !c || !floor || mayStep(getFootprint(c, to), floor, from.cell, to.cell, CARRIED)
}
