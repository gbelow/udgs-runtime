import type { BoardExtent, Coord, Direction } from '../../types'

// Hex arithmetic in axial coordinates (q, r), with the implied third cube
// axis s = -q - r. Nothing here is a rule: this is the metric the board
// rules measure against, and the one the movement table's "space" is
// counted in.

// The six neighbours of a cell, in the order that is also the rotation
// order: direction i + 1 is direction i turned one step counterclockwise as
// the board is drawn (the plane's y grows downward on screen).
export const DIRECTIONS: readonly Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

// The directions by index, in the order of DIRECTIONS.
export const ROTATIONS = [0, 1, 2, 3, 4, 5] as const satisfies readonly Direction[]

// A direction turned `steps` times clockwise.
export function turn(d: Direction, steps = 1): Direction {
  return ROTATIONS[(((d - steps) % 6) + 6) % 6]
}

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

// How many sides apart two directions are, either way round: 0 to 3.
export function sidesBetween(a: Direction, b: Direction): number {
  const d = (((a - b) % 6) + 6) % 6
  return Math.min(d, 6 - d)
}

// Breadth-first from `start`, one ring of cells per step for as long as
// `further` allows that many steps: every cell first come to along a path
// whose cells `enter` all admitted, with that path. A `steer` keeps the
// walk to a heading: no step turns more than `turn` sides off the step
// before it, nor the first off `heading` unless that is null.
export function walkOut(start: Coord, further: (steps: number) => boolean, enter: (cell: Coord, path: Coord[]) => boolean, steer?: { heading: Direction | null; turn: number }): { cell: Coord; path: Coord[]; steps: number }[] {
  const seen = new Set([coordKey(start)])
  const reached = steer ? new Set([coordKey(start)]) : seen
  const found: { cell: Coord; path: Coord[]; steps: number }[] = []
  let frontier: { cell: Coord; path: Coord[]; heading: Direction | null }[] = [{ cell: start, path: [], heading: steer?.heading ?? null }]
  for (let steps = 1; frontier.length > 0 && further(steps); steps++) {
    const next: typeof frontier = []
    for (const { cell, path, heading } of frontier) {
      for (const d of ROTATIONS) {
        if (steer && heading !== null && sidesBetween(heading, d) > steer.turn) continue
        const n = add(cell, DIRECTIONS[d])
        const at = coordKey(n)
        const key = steer ? `${at}:${d}` : at
        if (seen.has(key)) continue
        seen.add(key)
        const walked = [...path, n]
        if (!enter(n, walked)) continue
        next.push({ cell: n, path: walked, heading: d })
        if (steer && reached.has(at)) continue
        reached.add(at)
        found.push({ cell: n, path: walked, steps })
      }
    }
    frontier = next
  }
  return found
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

// Whether a cell lies within `extent` half-widths of the centre along each
// of the three hex axes.
export function inExtent(center: Coord, extent: BoardExtent, cell: Coord): boolean {
  const d = subtract(cell, center)
  return Math.abs(d.q) <= extent.q && Math.abs(d.r) <= extent.r && Math.abs(d.q + d.r) <= extent.s
}

// Every cell within `extent` of the centre, centre included.
export function extentCells(center: Coord, extent: BoardExtent): Coord[] {
  return disk(center, Math.max(extent.q, extent.r, extent.s)).filter((c) => inExtent(center, extent, c))
}

// An offset turned `steps` times about the origin in DIRECTIONS' order,
// counterclockwise as drawn. In cube coordinates one step is
// (x, y, z) -> (-z, -x, -y).
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
export function directionTo(from: Coord, to: Coord): Direction {
  const d = subtract(to, from)
  const ds = -d.q - d.r
  let best: Direction = 0
  let bestDot = -Infinity
  for (const i of ROTATIONS) {
    const dir = DIRECTIONS[i]
    const dot = d.q * dir.q + d.r * dir.r + ds * (-dir.q - dir.r)
    if (dot > bestDot) [best, bestDot] = [i, dot]
  }
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

// ---------------------------------------------------------------------------
// Angles

// Axial to the plane, pointy-top hexes of unit spacing.
export function toPlane(c: Coord): { x: number; y: number } {
  return { x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }
}

// The corners of a unit hex about its centre, as SVG polygon points.
export const HEX_POINTS = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30)
  return `${(Math.cos(angle)).toFixed(4)},${(Math.sin(angle)).toFixed(4)}`
}).join(' ')

// The SVG viewBox that frames hexes centred on the points, with a margin.
export function hexBounds(points: readonly { x: number; y: number }[]): { x: number; y: number; width: number; height: number } {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs) - 1
  const y = Math.min(...ys) - 1
  return { x, y, width: Math.max(...xs) + 1 - x, height: Math.max(...ys) + 1 - y }
}

export function frameHexes(points: readonly { x: number; y: number }[]): string {
  const { x, y, width, height } = hexBounds(points)
  return `${x.toFixed(3)} ${y.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}`
}

export function centroid(cells: readonly Coord[]): { x: number; y: number } {
  const points = cells.map(toPlane)
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}

export function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  return angle < 0 ? angle + 2 * Math.PI : angle
}

// How far one turns from `from` to reach `to` going one way round, in
// [0, 2π). Clockwise as the board is drawn is a turn the plane's angle
// climbs through, its y growing downward on screen.
export function directedTurn(from: number, to: number, clockwise: boolean): number {
  const delta = clockwise ? to - from : from - to
  return ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

// The smaller turn between two directions.
export function angularGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(gap, 2 * Math.PI - gap)
}
