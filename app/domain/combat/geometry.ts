import type { Coord } from './types'

// Hex arithmetic in axial coordinates (q, r), with the implied third cube
// axis s = -q - r. Nothing here is a rule: this is the metric the board
// lenses measure against, and the one the movement table's "space" is
// counted in.

// The six neighbours of a cell, in the order that is also the rotation
// order: direction i + 1 is direction i turned one step clockwise.
export const DIRECTIONS: readonly Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export type Orientation = 0 | 1 | 2 | 3 | 4 | 5

export function coordKey(c: Coord): string {
  return `${c.q},${c.r}`
}

export function parseCoordKey(key: string): Coord | null {
  const [q, r, ...rest] = key.split(',').map(Number)
  return rest.length === 0 && Number.isInteger(q) && Number.isInteger(r) ? { q, r } : null
}

export function sameCell(a: Coord, b: Coord): boolean {
  return a.q === b.q && a.r === b.r
}

export function add(a: Coord, b: Coord): Coord {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function subtract(a: Coord, b: Coord): Coord {
  return { q: a.q - b.q, r: a.r - b.r }
}

// The number of steps between two cells.
export function distance(a: Coord, b: Coord): number {
  const d = subtract(a, b)
  return (Math.abs(d.q) + Math.abs(d.r) + Math.abs(d.q + d.r)) / 2
}

// The fewest steps between any cell of one set and any cell of the other:
// how far apart two footprints stand, measured edge to edge.
export function setDistance(a: readonly Coord[], b: readonly Coord[]): number {
  let best = Infinity
  for (const x of a) for (const y of b) best = Math.min(best, distance(x, y))
  return best
}

export function neighbors(c: Coord): Coord[] {
  return DIRECTIONS.map((d) => add(c, d))
}

// Every cell exactly `radius` steps from the centre; the centre itself at 0.
export function ring(center: Coord, radius: number): Coord[] {
  if (radius === 0) return [center]
  const cells: Coord[] = []
  let cursor = add(center, { q: DIRECTIONS[4].q * radius, r: DIRECTIONS[4].r * radius })
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      cells.push(cursor)
      cursor = add(cursor, DIRECTIONS[side])
    }
  }
  return cells
}

// Every cell within `radius` steps of the centre, centre included.
export function disk(center: Coord, radius: number): Coord[] {
  const cells: Coord[] = []
  for (let k = 0; k <= radius; k++) cells.push(...ring(center, k))
  return cells
}

// An offset turned `steps` times clockwise about the origin. In cube
// coordinates one clockwise step is (x, y, z) -> (-z, -x, -y).
export function rotate(offset: Coord, steps: number): Coord {
  let { q, r } = offset
  for (let i = 0; i < ((steps % 6) + 6) % 6; i++) {
    const s = -q - r
    ;[q, r] = [-s, -q]
  }
  return { q, r }
}

// The direction from one cell towards another, as the nearest of the six:
// the one whose unit vector the displacement projects onto most. Both cells
// the same is direction 0.
export function directionTo(from: Coord, to: Coord): Orientation {
  const d = subtract(to, from)
  const ds = -d.q - d.r
  let best: Orientation = 0
  let bestDot = -Infinity
  DIRECTIONS.forEach((dir, i) => {
    const dot = d.q * dir.q + d.r * dir.r + ds * (-dir.q - dir.r)
    if (dot > bestDot) [best, bestDot] = [i as Orientation, dot]
  })
  return best
}

// The cells a straight line crosses from one cell to another, both included:
// a cube-coordinate lerp sampled once per step and rounded to the nearest
// cell. Ties are broken towards the start of the line, so `line(a, b)` and
// `line(b, a)` may differ by a cell.
export function line(a: Coord, b: Coord): Coord[] {
  const n = distance(a, b)
  if (n === 0) return [a]
  const cells: Coord[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    cells.push(roundCube(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6))
  }
  return cells
}

function roundCube(q: number, r: number): Coord {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: rq, r: rr }
}
