import type { Character } from '../../types'
import type { Coord, Placement } from '../types'
import { setDistance } from '../geometry'
import { getFootprint } from './board'

// How a mover's way brings them to someone, step by step.

// How far the mover's footprint stands from the other's at each placement
// along the way, the one set out from first.
export function getPathDistances(mover: Character, placements: Placement[], other: Coord[]): number[] {
  return placements.map((p) => setDistance(getFootprint(mover, p), other))
}

// combat.tex "Opportunity Attack": "moving towards a melee weapon while
// within its attack range" — the first step taken from within the range to
// closer still.
export function getApproachStep(distances: number[], range: number): number | null {
  return firstStep(distances, (previous, now) => previous <= range && now < previous)
}

// the first step, counted from 1, at which `moved` holds between the
// distance before it and the distance after it; `distances` starts with the
// one before the first step
export function firstStep(distances: number[], moved: (previous: number, now: number) => boolean): number | null {
  for (let i = 1; i < distances.length; i++) if (moved(distances[i - 1], distances[i])) return i
  return null
}
