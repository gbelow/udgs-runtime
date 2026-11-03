import { type AlphaFilter, type BlurFilter, Container, Graphics, Matrix, Sprite, Text, Texture, Rectangle, type TextStyleOptions } from 'pixi.js'
import type { BoardBindView, BoardCellView, BoardChordView, BoardFloorItemView, BoardGhostView, BoardGround, BoardGroundCell, BoardOverheadView, BoardRidgeView, BoardSpriteView, BoardTokenView, BoardView } from '../domain/scene/projections/boardView'
import type { SurfaceArt } from '../domain/scene/types'
import type { Grain, Point } from '../domain/scene/rules/board/geometry'
import { isFlatGround } from './ground'
import type { Palette, Token } from './palette'

// Every layer of the board as Pixi draws it, from the view alone: each
// function takes the part of the view it draws and gives back a display object
// that the stage places and throws away when that part changes.

export type Paint = { color: Token | 'black' | 'white'; alpha?: number }

// What a layer needs besides the view: the theme's colours, the pictures that
// have come, and the blurs, which are told the zoom so that they blur the same
// share of a cell however close the board is looked at.
export type Kit = {
  palette: Palette
  texture: (src: string) => Texture | null
  blur: (sigma: number) => BlurFilter
  fade: (alpha: number) => AlphaFilter
}

export function colorOf(kit: Kit, paint: Paint): { color: number; alpha: number } {
  const color = paint.color === 'black' ? 0x000000 : paint.color === 'white' ? 0xffffff : kit.palette[paint.color]
  return { color, alpha: paint.alpha ?? 1 }
}

const flat = (points: readonly Point[], dx = 0, dy = 0): number[] => points.flatMap((p) => [p.x + dx, p.y + dy])

// A polyline broken into dashes, `dash` the lengths of stroke and gap in turn.
export function dashed(g: Graphics, points: readonly Point[], closed: boolean, dash: readonly number[]) {
  const path = closed ? [...points, points[0]] : points
  let index = 0
  let left = dash[0]
  let on = true
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    let at = 0
    while (at < length) {
      const step = Math.min(left, length - at)
      if (on) {
        g.moveTo(a.x + ((b.x - a.x) * at) / length, a.y + ((b.y - a.y) * at) / length)
        g.lineTo(a.x + ((b.x - a.x) * (at + step)) / length, a.y + ((b.y - a.y) * (at + step)) / length)
      }
      at += step
      left -= step
      if (left <= 1e-9) {
        index = (index + 1) % dash.length
        left = dash[index]
        on = !on
      }
    }
  }
}

function circlePoints(r: number, x = 0, y = 0, n = 48): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: x + r * Math.cos((2 * Math.PI * i) / n), y: y + r * Math.sin((2 * Math.PI * i) / n) }))
}

// How a picture lies over the plane: `tile` board units to a repeat, moved by
// its offset and, on a wall, turned along the wall's grain.
function patternMatrix(art: Pick<SurfaceArt, 'tile' | 'offsetX' | 'offsetY'>, texture: Texture, grain: Grain | null = null): Matrix {
  const [kx, ky] = [art.tile / texture.source.width, art.tile / texture.source.height]
  const g = grain ?? { across: { x: 1, y: 0 }, down: { x: 0, y: 1 } }
  return new Matrix(g.across.x * kx, g.across.y * kx, g.down.x * ky, g.down.y * ky,
    g.across.x * art.offsetX + g.down.x * art.offsetY, g.across.y * art.offsetX + g.down.y * art.offsetY)
}

// ---------------------------------------------------------------------------
// Text, drawn at a large size and scaled down, so that it stays sharp zoomed in.

const TEXT_SIZE = 64

export function label(text: string, size: number, fill: number, at: Point, anchor: Point = { x: 0.5, y: 0.5 }, extra: Partial<TextStyleOptions> = {}): Text {
  const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: TEXT_SIZE, fill, ...extra }, anchor })
  t.scale.set(size / TEXT_SIZE)
  t.position.set(at.x, at.y)
  return t
}

// ---------------------------------------------------------------------------
// The ground of a band: the flat ground by the shader (`drawFlatGround`), the
// rest crisp, each cell its hex filled with its picture.

export function drawCrispGround(kit: Kit, ground: BoardGround, cells: BoardGroundCell[]): Graphics {
  const g = new Graphics()
  for (const c of cells) {
    if (c.art === null) continue
    const art = ground.arts[c.art]
    const texture = kit.texture(art.src)
    if (!texture) continue
    g.poly(flat(c.hex ?? ground.hex, c.x, c.y)).fill({ texture, matrix: patternMatrix(art, texture), textureSpace: 'global' })
  }
  return g
}

// Which ground cells of a band are drawn crisp.
export function crispCells(cells: BoardGroundCell[], band: number): BoardGroundCell[] {
  return cells.filter((c) => c.band === band && !isFlatGround(c))
}

// ---------------------------------------------------------------------------
// The walls of a band: the drops of cliffs, the thin walls, the slices of
// structure pictures.

const FACE_SHADE = 0.45
let shadeTexture: Texture | null = null

// A ramp from clear to the face's shade, laid down a face from its ridge to its
// foot; mirrored past its ends so that a corner a little beyond either is not
// drawn with the other end's shade.
function getShadeTexture(): Texture {
  if (shadeTexture) return shadeTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  const ramp = ctx.createLinearGradient(0, 0, 64, 0)
  ramp.addColorStop(0, 'rgba(0,0,0,0)')
  ramp.addColorStop(1, `rgba(0,0,0,${FACE_SHADE})`)
  ctx.fillStyle = ramp
  ctx.fillRect(0, 0, 64, 1)
  shadeTexture = Texture.from(canvas)
  shadeTexture.source.style.addressMode = 'mirror-repeat'
  shadeTexture.source.style.update()
  return shadeTexture
}

function shadeMatrix(from: Point, to: Point): Matrix {
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const length = Math.hypot(dx, dy) || 1
  return new Matrix(dx / 64, dy / 64, -dy / length, dx / length, from.x, from.y)
}

export function drawRidges(kit: Kit, ridges: BoardRidgeView[], faces: SurfaceArt[], front: boolean): Graphics {
  const g = new Graphics()
  const shade = getShadeTexture()
  for (const r of ridges) {
    const mid = { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 }
    for (const b of r.bands) {
      if (b.face === null) continue
      const art = b.art === null ? null : faces[b.art]
      const texture = art ? kit.texture(art.src) : null
      if (art && texture) g.poly(flat(b.face)).fill({ texture, matrix: patternMatrix(art, texture, r.grain), textureSpace: 'global' })
      else if (b.glass) g.poly(flat(b.face)).fill(colorOf(kit, { color: 'accent', alpha: 0.25 }))
      else g.poly(flat(b.face)).fill(colorOf(kit, { color: 'fg', alpha: 0.3 }))
      if (!b.glass) g.poly(flat(b.face)).fill({ texture: shade, matrix: shadeMatrix(mid, r.foot), textureSpace: 'global' })
    }
    if (!front) g.moveTo(r.a.x, r.a.y).lineTo(r.b.x, r.b.y).stroke({ width: 0.12, cap: 'round', ...colorOf(kit, { color: 'fg' }) })
  }
  return g
}

export function drawChords(kit: Kit, chords: BoardChordView[]): Graphics {
  const g = new Graphics()
  for (const w of chords) {
    const texture = !w.glass && w.face && w.grain ? kit.texture(w.face.src) : null
    if (w.side !== null) {
      if (texture && w.face) g.poly(flat(w.side)).fill({ texture, matrix: patternMatrix(w.face, texture, w.grain), textureSpace: 'global' }).stroke({ width: 0.02, ...colorOf(kit, { color: 'fg', alpha: 0.7 }) })
      else g.poly(flat(w.side)).fill(colorOf(kit, w.glass ? { color: 'accent', alpha: 0.25 } : { color: 'fg', alpha: 0.6 })).stroke({ width: 0.02, ...colorOf(kit, w.glass ? { color: 'accent', alpha: 0.5 } : { color: 'fg', alpha: 0.7 }) })
    }
    g.poly(flat(w.top)).fill(colorOf(kit, w.glass ? { color: 'accent', alpha: 0.4 } : { color: 'fg' })).stroke({ width: 0.02, ...colorOf(kit, { color: w.glass ? 'accent' : 'fg' }) })
  }
  return g
}

export function drawSprites(kit: Kit, sprites: BoardSpriteView[]): Container {
  const out = new Container()
  for (const s of sprites) {
    const texture = kit.texture(s.src)
    if (!texture) continue
    const [kx, ky] = [texture.source.width / s.box.width, texture.source.height / s.box.height]
    const frame = new Rectangle((s.clip.x - s.box.x) * kx, (s.clip.y - s.box.y) * ky, s.clip.width * kx, s.clip.height * ky)
    if (frame.width <= 0 || frame.height <= 0) continue
    const sprite = new Sprite(new Texture({ source: texture.source, frame }))
    sprite.position.set(s.clip.x, s.clip.y)
    sprite.width = s.clip.width
    sprite.height = s.clip.height
    out.addChild(sprite)
  }
  return out
}

// ---------------------------------------------------------------------------
// The cells of a band as play marks them: what a click there would do, what
// lies on them, and what their ground is when it has no picture.

const TERRAIN_FILL: Record<BoardCellView['terrain'], Paint> = {
  open: { color: 'surface' },
  wall: { color: 'line' },
  glass: { color: 'accent', alpha: 0.25 },
  water: { color: 'accent', alpha: 0.1 },
  rough: { color: 'muted', alpha: 0.2 },
}

const TERRAIN_GLYPH: Record<BoardCellView['terrain'], string> = { open: '', wall: '', glass: '◇', water: '≈', rough: '∴' }

const ZONE_FILL: Record<NonNullable<BoardCellView['zone']>, Paint> = {
  critical: { color: 'bad', alpha: 0.6 },
  hit: { color: 'bad', alpha: 0.35 },
  graze: { color: 'bad', alpha: 0.15 },
  miss: { color: 'bad', alpha: 0.05 },
}

function cellFill(c: BoardCellView): Paint | null {
  if (c.isJumpTo) return { color: 'good', alpha: 0.4 }
  if (c.pathStep !== null) return { color: 'accent', alpha: 0.4 }
  if (c.swept) return { color: 'accent', alpha: 0.2 }
  if (c.zone) return ZONE_FILL[c.zone]
  if (c.reachable || c.jump || c.center) return { color: 'good', alpha: 0.35 }
  if (c.threatened) return { color: 'bad', alpha: 0.1 }
  if (c.fire > 0) return { color: 'injury-2', alpha: 0.3 }
  if (c.fuels.length > 0) return { color: 'accent', alpha: 0.15 }
  if (c.suffocating) return { color: 'fg', alpha: 0.25 }
  if (c.art !== null && c.terrain === 'open') return null
  return TERRAIN_FILL[c.terrain]
}

function cellStroke(c: BoardCellView): { paint: Paint; width: number } {
  const offered = !!(c.reachable || c.jump || c.center)
  const paint: Paint = c.isDestination || c.isJumpTo || c.isCenter || c.chosen ? { color: 'accent' }
    : offered ? { color: 'good' }
    : c.piece !== null ? { color: 'accent', alpha: 0.4 }
    : c.art !== null ? { color: 'line', alpha: 0.3 }
    : { color: 'line' }
  return { paint, width: c.chosen ? 0.14 : offered ? 0.12 : 0.06 }
}

export function drawCells(kit: Kit, cells: BoardCellView[], hex: Point[]): Container {
  const out = new Container()
  const g = new Graphics()
  const marks = new Graphics()
  out.addChild(g, marks)
  for (const c of cells) {
    const corners = flat(c.hex ?? hex, c.x, c.y)
    const fill = cellFill(c)
    const stroke = cellStroke(c)
    g.poly(corners)
    if (fill) g.fill(colorOf(kit, fill))
    g.stroke({ width: stroke.width, ...colorOf(kit, stroke.paint) })
    const shape = (c.hex ?? hex).map((p) => ({ x: p.x + c.x, y: p.y + c.y }))
    if (c.storey === 'roof') marks.poly(corners).fill(colorOf(kit, { color: 'fg', alpha: 0.1 }))
    if (c.storey === 'lattice') { dashed(marks, shape, true, [0.1, 0.1]); marks.stroke({ width: 0.08, ...colorOf(kit, { color: 'good' }) }) }
    if (c.storey === 'air' || c.storey === 'hole') {
      marks.poly(corners).fill(colorOf(kit, { color: 'bg', alpha: 0.55 }))
      if (c.storey === 'hole') { dashed(marks, shape, true, [0.2, 0.12]); marks.stroke({ width: 0.1, ...colorOf(kit, { color: 'accent' }) }) }
    }
    const say = (text: string, size: number, color: Token, dx: number, dy: number, anchorY = 0.5) => out.addChild(label(text, size, kit.palette[color], { x: c.x + dx, y: c.y + dy }, { x: 0.5, y: anchorY }))
    if (TERRAIN_GLYPH[c.terrain] && !c.unseen) say(TERRAIN_GLYPH[c.terrain], 0.7, 'muted', 0, 0)
    if (c.elevationLabel) say(c.elevationLabel, 0.4, 'muted', 0, -0.45, 0.8)
    if (c.fire > 0 && c.pathStep === null) say(`🔥${c.fire}`, 0.35, 'injury-2', 0, 0.45, 0.8)
    if (c.noise > 0 && c.fire === 0 && c.pathStep === null) say(`♪${c.noise}`, 0.35, 'muted', 0, 0.45, 0.8)
    if (c.climbDL !== null && !c.unseen) say(`⇡${c.climbDL}`, 0.3, 'good', 0.5, 0.05)
    if (c.pathStep !== null) say(`${c.pathStep}`, 0.4, 'fg', 0, 0.45, 0.8)
  }
  return out
}

// ---------------------------------------------------------------------------
// The fog of a band: where the ground is misty, a veil over the cells it
// covers, blurred so that it falls off softly instead of in steps of whole
// hexes. Each level is drawn whole and faded as one, so that the cells of one
// level do not add up where they overlap. Light and darkness are drawn by the
// shade map (light.ts).

const SHADE_BLUR = 0.35
const SHADE_BLEED = 0.45
const MIST_BAD = 0.35
const MIST_ZERO = 0.7

function levelsOf(cells: BoardCellView[], levelOf: (c: BoardCellView) => number): { level: number; cells: BoardCellView[] }[] {
  const levels = new Map<number, BoardCellView[]>()
  for (const c of cells) {
    const level = levelOf(c)
    if (level > 0) levels.set(level, [...(levels.get(level) ?? []), c])
  }
  return [...levels.entries()].sort(([a], [b]) => a - b).map(([level, at]) => ({ level, cells: at }))
}

export function drawMist(kit: Kit, cells: BoardCellView[], hex: Point[]): Container {
  const out = new Container()
  const veils: { paint: number; opacity: number; levels: { level: number; cells: BoardCellView[] }[] }[] = [
    { paint: 0xc9d4dc, opacity: 1, levels: levelsOf(cells, (c) => (c.visibility === null ? 0 : c.visibility === 'zero' ? MIST_ZERO : MIST_BAD)) },
  ]
  for (const veil of veils) {
    if (veil.levels.length === 0) continue
    const group = new Container()
    group.filters = [kit.blur(SHADE_BLUR)]
    for (const { level, cells: at } of veil.levels) {
      const g = new Graphics()
      for (const c of at) g.poly(flat(c.hex ?? hex, c.x, c.y)).fill({ color: veil.paint }).stroke({ width: 2 * SHADE_BLEED, join: 'round', color: veil.paint })
      g.filters = [kit.fade(level * veil.opacity)]
      group.addChild(g)
    }
    out.addChild(group)
  }
  return out
}

// ---------------------------------------------------------------------------
// The lattices over the floors drawn: the shadow each casts on the floor under
// it, then, seen from the front, the sides of its leaves, darker, and its top,
// faded so that what is under it shows, or a dashed outline where nothing was
// laid on it.

const OVERHEAD_OPACITY = 0.6
const OVERHEAD_SHADOW_BLUR = 0.25

export function drawOverhead(kit: Kit, overhead: BoardOverheadView[], hex: Point[]): Container {
  const out = new Container()
  if (overhead.length === 0) return out
  const shadows = new Graphics()
  for (const o of overhead) shadows.poly(flat(hex, o.shadow.x, o.shadow.y)).fill({ color: 0x000000, alpha: 0.35 })
  shadows.filters = [kit.blur(OVERHEAD_SHADOW_BLUR)]
  const leaves = new Graphics()
  const tops = new Graphics()
  for (const o of overhead) {
    const texture = o.art ? kit.texture(o.art.src) : null
    const fill = o.art && texture ? { texture, matrix: patternMatrix(o.art, texture), textureSpace: 'global' as const } : colorOf(kit, { color: 'good', alpha: 0.2 })
    for (const slab of o.slab) leaves.poly(flat(slab)).fill(fill).poly(flat(slab)).fill({ color: 0x000000, alpha: 0.4 })
    tops.poly(flat(hex, o.x, o.y)).fill(fill)
    if (!o.art) { dashed(tops, hex.map((p) => ({ x: p.x + o.x, y: p.y + o.y })), true, [0.1, 0.1]); tops.stroke({ width: 0.08, ...colorOf(kit, { color: 'good' }) }) }
  }
  const faded = new Container()
  faded.addChild(leaves, tops)
  faded.filters = [kit.fade(OVERHEAD_OPACITY)]
  out.addChild(shadows, faded)
  return out
}

// ---------------------------------------------------------------------------
// The space the pointer is on: its top and the walls under it lit, and the
// space it is picked by, where it stands on the ground.

export function drawLit(kit: Kit, view: BoardView, key: string | null): Graphics {
  const g = new Graphics()
  const cell = key === null ? undefined : view.cells.find((c) => c.key === key)
  if (!cell) return g
  const accent = colorOf(kit, { color: 'accent' })
  for (const r of view.ridges) {
    if (r.cell !== cell.key) continue
    for (const b of r.bands) if (b.face) g.poly(flat(b.face)).fill({ ...accent, alpha: 0.25 }).stroke({ width: 0.08, ...accent })
  }
  g.poly(flat(cell.hex ?? view.hex, cell.x, cell.y)).fill({ ...accent, alpha: 0.25 }).stroke({ width: 0.1, ...accent })
  if (cell.base) g.poly(flat(view.hex, cell.base.x, cell.base.y)).stroke({ width: 0.1, ...colorOf(kit, { color: 'fg' }) })
  return g
}

// ---------------------------------------------------------------------------
// What stands on the board: the characters, what binds them, where a push
// leaves them, and what lies on the floor.

export const TOKEN_RADIUS = 0.62

export function drawToken(kit: Kit, t: BoardTokenView, hex: Point[], picked: boolean): Container {
  const out = new Container()
  out.alpha = t.elsewhere ? 0.35 : t.hidden ? 0.6 : 1
  const under = new Graphics()
  for (const c of t.cells) under.poly(flat(hex, c.x, c.y)).fill(colorOf(kit, { color: 'fg', alpha: 0.15 }))
  if (t.shadow) under.ellipse(t.shadow.x, t.shadow.y + 0.5, 0.55, 0.2).fill(colorOf(kit, { color: 'fg', alpha: 0.3 }))
  out.addChild(under)

  const body = new Container()
  body.position.set(t.x, t.y)
  out.addChild(body)
  const ring: Token = picked ? 'accent' : t.targetable ? 'bad' : t.isActive ? 'accent' : t.isInTurn ? 'good' : 'muted'
  const width = picked || t.isActive || t.targetable ? 0.12 : 0.06
  const g = new Graphics()
  g.circle(0, 0, TOKEN_RADIUS).fill(colorOf(kit, { color: 'raised' }))
  const picture = t.image ? kit.texture(t.image) : null
  if (picture) g.circle(0, 0, TOKEN_RADIUS).fill({ texture: picture, textureSpace: 'local' })
  if (t.targetable || t.hidden) { dashed(g, circlePoints(TOKEN_RADIUS), true, [0.2, 0.12]); g.stroke({ width, ...colorOf(kit, { color: ring }) }) }
  else g.circle(0, 0, TOKEN_RADIUS).stroke({ width, ...colorOf(kit, { color: ring }) })
  if (t.shieldAngle !== null) {
    const shield = new Graphics().roundRect(0.72, -0.45, 0.16, 0.9, 0.05).fill(colorOf(kit, { color: 'accent' }))
    shield.rotation = (t.shieldAngle * Math.PI) / 180
    body.addChild(g, shield)
  } else body.addChild(g)
  if (!picture) body.addChild(label(t.name.slice(0, 2), 0.45, kit.palette.fg, { x: 0, y: 0 }))
  body.addChild(label(t.name, 0.32, kit.palette.fg, { x: 0, y: 0.95 }, { x: 0.5, y: 0.75 }, { fontWeight: '600', stroke: { color: kit.palette.bg, width: 0.16 * TEXT_SIZE / 0.32, join: 'round' } }))
  if (t.hanging) {
    const chevron = new Graphics().moveTo(0.7, -0.4).lineTo(0.95, 0).lineTo(0.7, 0.4).stroke({ width: 0.1, cap: 'round', join: 'round', ...colorOf(kit, { color: 'good' }) })
    chevron.rotation = (t.hanging.angle * Math.PI) / 180
    body.addChild(chevron, label(`⇡${t.hanging.covered}/${t.hanging.height}`, 0.32, kit.palette.good, { x: 0.75, y: -0.8 }, { x: 0.5, y: 0.8 }))
  }
  if (t.depth > 0) body.addChild(label(`↓${t.depth}`, 0.35, kit.palette.accent, { x: 0, y: -0.8 }, { x: 0.5, y: 0.8 }))
  return out
}

// The rings round the characters the committed action still waits on, which
// the stage pulses.
export function drawAwaited(kit: Kit, tokens: BoardTokenView[]): Graphics {
  const g = new Graphics()
  for (const t of tokens) {
    if (!t.awaited) continue
    dashed(g, circlePoints(0.82, t.x, t.y), true, [0.25, 0.15])
    g.stroke({ width: 0.08, ...colorOf(kit, { color: 'accent' }) })
  }
  return g
}

const BIND_STROKE: Record<BoardBindView['kind'], { paint: Paint; dash?: number[] }> = {
  grapple: { paint: { color: 'fg' } },
  tether: { paint: { color: 'muted' }, dash: [0.3, 0.15] },
  arc: { paint: { color: 'accent' }, dash: [0.05, 0.12] },
  link: { paint: { color: 'accent' }, dash: [0.3, 0.15, 0.05, 0.15] },
}

const GRIP = 0.32

export function drawBinds(kit: Kit, binds: BoardBindView[]): Graphics {
  const g = new Graphics()
  for (const b of binds) {
    const { paint, dash } = BIND_STROKE[b.kind]
    if (dash) dashed(g, [b.from, b.to], false, dash)
    else g.moveTo(b.from.x, b.from.y).lineTo(b.to.x, b.to.y)
    g.stroke({ width: 0.08, cap: 'round', ...colorOf(kit, paint) })
    const length = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y) || 1
    const [ux, uy] = [(b.to.x - b.from.x) / length, (b.to.y - b.from.y) / length]
    const head = (tip: Point, dx: number, dy: number) => g.poly([tip.x, tip.y, tip.x - dx * GRIP - dy * GRIP / 2, tip.y - dy * GRIP + dx * GRIP / 2, tip.x - dx * GRIP + dy * GRIP / 2, tip.y - dy * GRIP - dx * GRIP / 2]).fill(colorOf(kit, { color: 'fg' }))
    if (b.forward) head(b.to, ux, uy)
    if (b.back) head(b.from, -ux, -uy)
  }
  return g
}

export function drawGhosts(kit: Kit, ghosts: BoardGhostView[], hex: Point[]): Container {
  const out = new Container()
  const g = new Graphics()
  out.addChild(g)
  for (const ghost of ghosts) {
    for (const c of ghost.cells) g.poly(flat(hex, c.x, c.y)).fill(colorOf(kit, { color: 'accent', alpha: 0.1 }))
    dashed(g, circlePoints(TOKEN_RADIUS, ghost.x, ghost.y), true, [0.15, 0.1])
    g.stroke({ width: 0.06, ...colorOf(kit, { color: 'accent' }) })
    out.addChild(label(ghost.name.slice(0, 2), 0.45, kit.palette.accent, { x: ghost.x, y: ghost.y }))
  }
  return out
}

export const FLOOR_ITEM_HALF = 0.16

export function drawFloor(kit: Kit, floor: BoardFloorItemView[], hovered: string | null): Graphics {
  const g = new Graphics()
  for (const f of floor) {
    const live = f.pickable || f.targetable
    g.roundRect(f.x - FLOOR_ITEM_HALF, f.y - FLOOR_ITEM_HALF, 2 * FLOOR_ITEM_HALF, 2 * FLOOR_ITEM_HALF, 0.05)
      .fill(colorOf(kit, { color: live ? (hovered === f.itemId ? 'good' : 'accent') : 'muted' }))
      .stroke({ width: 0.04, ...colorOf(kit, { color: live ? 'fg' : 'line' }) })
  }
  return g
}
