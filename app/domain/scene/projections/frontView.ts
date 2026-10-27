import { frameHexes, hexBounds } from '../rules/board/geometry'
import type { BoardBindView, BoardCellView, BoardFloorItemView, BoardGhostView, BoardRidgeView, BoardTokenView, BoardView } from './boardView'

// The board seen from the front rather than from above: ground that is higher
// is drawn higher up the screen by so much a metre, and a cell is drawn over
// the ones behind it, so that a plateau hides what lies behind it and shows
// its drop as a wall. Only a way of drawing the same board; the rules read
// none of it.

// The sides of a flat-top hex that face the viewer, by direction: south-east,
// south-west and south.
const FRONT_SIDES: readonly number[] = [0, 4, 5]

type Point = { x: number; y: number }

const CORNERS: Point[] = Array.from({ length: 6 }, (_, i) => ({ x: Math.cos((Math.PI / 3) * i), y: Math.sin((Math.PI / 3) * i) }))

function inside(p: Point, polygon: readonly Point[]): boolean {
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross === 0) continue
    if (sign !== 0 && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

function parsePoints(points: string): Point[] {
  return points.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
}

const cache = new WeakMap<BoardView, Map<number, BoardView>>()

// The same board from the front, `lift` board units to the metre. Memoized per
// view, so a view that has not changed is drawn from the same object.
export function getFrontView(view: BoardView, lift: number): BoardView {
  if (!view.present) return view
  const known = cache.get(view)?.get(lift)
  if (known) return known
  const front = build(view, lift)
  cache.set(view, (cache.get(view) ?? new Map()).set(lift, front))
  return front
}

function build(view: BoardView, lift: number): BoardView {
  const rise = (metres: number) => metres * lift
  const levels = [...new Set(view.cells.map((c) => c.elevation))].sort((a, b) => a - b)
  const elevationOf = new Map(view.cells.map((c) => [c.key, c.elevation]))
  const bandOf = new Map(view.cells.map((c) => [c.key, levels.indexOf(c.elevation)]))

  const cells: BoardCellView[] = view.cells.map((c) => ({ ...c, y: c.y - rise(c.elevation), band: bandOf.get(c.key) ?? 0 }))

  // Each drop on a side that faces the viewer is a wall from the top edge of the
  // higher cell down to the same edge at the height of the lower ground; the
  // other drops are hidden behind their own cell.
  const ridges: BoardRidgeView[] = view.ridges.filter((r) => FRONT_SIDES.includes(r.side)).map((r) => {
    const top = rise(elevationOf.get(r.cell) ?? 0)
    const bottom = top - rise(r.height)
    const [a, b] = [{ x: r.a.x, y: r.a.y - top }, { x: r.b.x, y: r.b.y - top }]
    const [c, d] = [{ x: r.b.x, y: r.b.y - bottom }, { x: r.a.x, y: r.a.y - bottom }]
    const face = [a, b, c, d].map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')
    return { ...r, band: bandOf.get(r.cell) ?? 0, a, b, foot: { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 }, face }
  })

  // What is drawn over a place on the screen: a cell of a higher band, or the
  // wall under one.
  const covers: { band: number; polygon: Point[] }[] = [
    ...cells.map((c) => ({ band: c.band, polygon: CORNERS.map((p) => ({ x: c.x + p.x, y: c.y + p.y })) })),
    ...ridges.map((r) => ({ band: r.band, polygon: parsePoints(r.face) })),
  ]
  const tokens: BoardTokenView[] = view.tokens.map((t) => {
    const ground = t.cells.find((c) => c.x === t.x && c.y === t.y) ?? t.cells[0]
    const groundElevation = ground ? elevationOf.get(ground.key) ?? 0 : t.elevation
    const dy = rise(t.elevation)
    const centre = { x: t.x, y: t.y - dy }
    const band = ground ? bandOf.get(ground.key) ?? 0 : 0
    return {
      ...t,
      y: centre.y,
      cells: t.cells.map((c) => ({ ...c, y: c.y - dy })),
      shadow: { x: t.x, y: t.y - rise(groundElevation) },
      hidden: covers.some((o) => o.band > band && inside(centre, o.polygon)),
    }
  })

  const lifted = new Map(view.tokens.map((t) => [t.id, rise(t.elevation)]))
  const floor: BoardFloorItemView[] = view.floor.map((f) => ({ ...f, y: f.y - rise(elevationOf.get(f.cell) ?? 0) }))
  const binds: BoardBindView[] = view.binds.map((b) => ({
    ...b,
    from: { x: b.from.x, y: b.from.y - (lifted.get(b.ids[0]) ?? 0) },
    to: { x: b.to.x, y: b.to.y - (lifted.get(b.ids[1]) ?? 0) },
  }))
  const ghosts: BoardGhostView[] = view.ghosts.map((g) => {
    const dy = rise(elevationOf.get(g.cells[0]?.key ?? '') ?? 0)
    return { ...g, y: g.y - dy, cells: g.cells.map((c) => ({ ...c, y: c.y - dy })) }
  })

  return { ...view, front: true, bands: levels.length, cells, ridges, tokens, floor, binds, ghosts, frame: hexBounds(cells), viewBox: frameHexes(cells) }
}
