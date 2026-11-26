import { AlphaFilter, Application, BlurFilter, Container, type Graphics } from 'pixi.js'
import type { BoardCellView, BoardTokenView, BoardView } from '../domain/scene/projections/boardView'
import type { Coord } from '../domain/scene/types'
import type { Point } from '../domain/scene/rules/board/geometry'
import { readPalette } from './palette'
import { getTexture } from './textures'
import { drawFlatGround } from './ground'
import { FLOOR_ITEM_HALF, crispCells, drawAwaited, drawCorners, drawBinds, drawCells, drawChords, drawCrispGround, drawFloor, drawGhosts, drawLit, drawMarker, drawMist, drawOverhead, drawRidges, drawSprites, drawToken, tokenBody, type Kit } from './draw'
import { destroyShadeTargets, drawShadeCorners, drawShadeMap, drawShadeOver, makeShadeTargets, type ShadeMap } from './light'

// The board drawn on a canvas by Pixi: the view as the domain gives it, laid
// out band by band, each part of a band drawn again only when what it is
// drawn from changes, and the canvas drawn again only when something on it
// did. The stage holds the camera (the wheel zooms where the pointer is, a
// drag pans, and the press that ends a drag is no click) and reads where the
// pointer is; what a click or a hover means is the caller's.

export type BoardInput = {
  view: BoardView
  // what is drawn apart, blurred and faded, so that what lies behind it shows
  veiled: readonly string[]
  // the characters picked by hand, drawn with the accent ring
  picked: readonly string[]
}

export type BoardHover =
  | { kind: 'cell'; key: string; x: number; y: number }
  | { kind: 'token'; id: string; x: number; y: number }
  | { kind: 'floor'; itemId: string; x: number; y: number }

export type BoardEvents = {
  // the cell a point of the plane picks
  cellAt: (view: BoardView, point: Point) => BoardCellView | null
  onCell?: (cell: Coord) => void
  onToken?: (id: string) => void
  onFloorItem?: (itemId: string) => void
  // what the pointer is on, with where it is in the canvas's own pixels
  onHover?: (hover: BoardHover | null) => void
  onZoomed?: (zoomed: boolean) => void
}

const ZOOM_STEP = 1.2
const MIN_ZOOM = 0.5
const MAX_ZOOM = 8
// how far the pointer goes before a press is a pan and not a click
const PAN_SLOP = 4
// how much of a blur's spread its strength is
const BLUR_PER_SIGMA = 2
const VEIL_BLUR = 0.15
const VEIL_OPACITY = 0.45
const PULSE_SECONDS = 2
// a token drawn somewhere new with no walk to take it there slides there
const SLIDE_MS = 250
// what an action did rises this far off the token while it shows, a marker
// on the same token waiting for the one before it to be read
const MARKER_MS = 1400
const MARKER_RISE = 0.9
const MARKER_GAP_MS = 400

type Part = { deps: unknown[]; object: Container }
// A token on its way: the places it passes, and when it is at each, in
// milliseconds from `start`.
type Walk = { points: Point[]; times: number[]; start: number }
type Float = { id: string; node: Container; start: number }
type Band = { root: Container; normal: Container; veiled: Container; parts: Record<string, Part> }

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

export class BoardStage {
  private app = new Application()
  private ready = false
  private disposed = false
  private input: BoardInput | null = null
  private drawn: BoardInput | null = null
  private world = new Container()
  private bandLayer = new Container()
  private top = new Container()
  private bands: Band[] = []
  private parts: Record<string, Part> = {}
  private litLayer = new Container()
  private hovered = ''
  private awaited: Graphics | null = null
  private lit: string | null = null
  private hoveredItem: string | null = null
  private textures = 0
  private blurs = new Map<number, BlurFilter>()
  private fades = new Map<number, AlphaFilter>()
  private kit: Kit
  private shade: { deps: unknown[]; map: ShadeMap | null } = { deps: [], map: null }
  private shadeTargets = makeShadeTargets()
  private camera = { scale: 1, x: 0, y: 0, zoomed: false, fit: 1 }
  private framed = ''
  private frameRequest = 0
  private press: { id: number; x: number; y: number; camera: { x: number; y: number }; panning: boolean } | null = null
  private resize: ResizeObserver | null = null
  // what is played: the motions and markers seen (those of the first view
  // drawn are taken as seen, not played), the tokens on their way, where each
  // token was drawn last, and the markers rising
  private played = new Set<string>()
  private primed = false
  private still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  private walks = new Map<string, Walk>()
  private lastAt = new Map<string, Point>()
  private lastFront: boolean | null = null
  private tokenNodes = new Map<string, Container>()
  private floats: Float[] = []
  private floatLayer = new Container()

  constructor(private host: HTMLElement, private events: BoardEvents) {
    const onTexture = () => { this.textures++; this.sync() }
    this.kit = {
      palette: readPalette(),
      texture: (src) => getTexture(src, onTexture),
      blur: (sigma) => {
        let filter = this.blurs.get(sigma)
        if (!filter) {
          filter = new BlurFilter({ strength: sigma * BLUR_PER_SIGMA * this.camera.scale, quality: 4 })
          this.blurs.set(sigma, filter)
        }
        return filter
      },
      fade: (alpha) => {
        let filter = this.fades.get(alpha)
        if (!filter) {
          filter = new AlphaFilter({ alpha })
          this.fades.set(alpha, filter)
        }
        return filter
      },
    }
    void this.init()
  }

  private async init() {
    await this.app.init({ backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1, preference: 'webgl', autoStart: false, width: Math.max(1, this.host.clientWidth), height: Math.max(1, this.host.clientHeight) })
    if (this.disposed) { this.app.destroy(true, { children: true }); return }
    this.app.ticker.stop()
    const canvas = this.app.canvas
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    this.host.appendChild(canvas)
    this.world.addChild(this.bandLayer, this.litLayer, this.top, this.floatLayer)
    this.app.stage.addChild(this.world)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => { if (this.press?.panning) e.preventDefault() })
    this.resize = new ResizeObserver(() => this.onResize())
    this.resize.observe(this.host)
    this.ready = true
    this.sync()
  }

  set(input: BoardInput) {
    this.input = input
    this.sync()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameRequest)
    this.resize?.disconnect()
    if (this.ready) {
      this.app.canvas.remove()
      this.app.destroy(true, { children: true })
    }
    destroyShadeTargets(this.shadeTargets)
    this.blurs.forEach((f) => f.destroy())
    this.fades.forEach((f) => f.destroy())
  }

  // ---------------------------------------------------------------------------
  // Drawing

  // A part of the board, drawn again only when what it is drawn from has
  // changed; the old drawing is thrown away.
  private part(store: Record<string, Part>, name: string, parent: Container, deps: unknown[], draw: () => Container): void {
    const known = store[name]
    if (known && sameDeps(known.deps, deps)) {
      parent.addChild(known.object)
      return
    }
    known?.object.destroy({ children: true })
    const object = draw()
    store[name] = { deps, object }
    parent.addChild(object)
  }

  private sync() {
    if (!this.ready || !this.input || this.disposed) return
    const { view, veiled, picked } = this.input
    const frame = `${view.frame.x} ${view.frame.y} ${view.frame.width} ${view.frame.height}`
    if (frame !== this.framed) {
      this.framed = frame
      this.fit()
    }
    const shadeDeps = [view.cells, view.chords, view.lights]
    if (!sameDeps(this.shade.deps, shadeDeps)) this.shade = { deps: shadeDeps, map: drawShadeMap(this.app.renderer, this.shadeTargets, view.cells, view.chords, view.lights) }
    this.syncBands(view, veiled)
    const top = this.top
    top.removeChildren()
    this.part(this.parts, 'overhead', top, [view.ground.overhead, view.hex, this.textures], () => drawOverhead(this.kit, view.ground.overhead, view.hex))
    this.queue(view)
    this.part(this.parts, 'tokens', top, [view.tokens, view.hex, picked, this.textures], () => {
      const out = new Container()
      this.tokenNodes.clear()
      view.tokens.forEach((t) => {
        const node = drawToken(this.kit, t, view.hex, picked.includes(t.id))
        this.tokenNodes.set(t.id, node)
        out.addChild(node)
      })
      return out
    })
    this.part(this.parts, 'awaited', top, [view.tokens], () => drawAwaited(this.kit, view.tokens))
    this.awaited = this.parts.awaited.object as Graphics
    this.part(this.parts, 'binds', top, [view.binds], () => drawBinds(this.kit, view.binds))
    this.part(this.parts, 'ghosts', top, [view.ghosts, view.hex], () => drawGhosts(this.kit, view.ghosts, view.hex))
    this.part(this.parts, 'floor', top, [view.floor, this.hoveredItem], () => drawFloor(this.kit, view.floor, this.hoveredItem))
    this.drawLit()
    this.drawn = this.input
    this.render()
  }

  private syncBands(view: BoardView, veiledGroups: readonly string[]) {
    const veiled = new Set(veiledGroups)
    const ground = view.ground
    while (this.bands.length > view.bands) this.bands.pop()!.root.destroy({ children: true })
    while (this.bands.length < view.bands) {
      const root = new Container()
      const normal = new Container()
      const apart = new Container()
      apart.filters = [this.kit.blur(VEIL_BLUR), this.kit.fade(VEIL_OPACITY)]
      root.addChild(normal, apart)
      this.bands.push({ root, normal, veiled: apart, parts: {} })
    }
    this.bandLayer.removeChildren()
    const cellsOf = [...view.rims, ...view.cells]
    const groundOf = [...ground.rims, ...ground.cells]
    const cellByKey = new Map(view.cells.map((c) => [c.key, c]))
    this.bands.forEach((band, b) => {
      this.bandLayer.addChild(band.root)
      const inBand = <T extends { band: number }>(list: T[]) => list.filter((x) => x.band === b)
      const groups = new Set([...inBand(groundOf), ...inBand(ground.ridges), ...inBand(ground.chords), ...inBand(ground.sprites)].map((x) => x.group))
      const shown = [...groups].filter((g) => veiled.has(g)).sort().join('\n')
      band.normal.removeChildren()
      band.veiled.removeChildren()
      for (const apart of shown ? [false, true] : [false]) {
        const keep = <T extends { group: string }>(list: T[]) => (shown ? list.filter((x) => veiled.has(x.group) === apart) : list)
        const parent = apart ? band.veiled : band.normal
        const tag = apart ? 'veiled' : 'normal'
        this.part(band.parts, `surface-${tag}`, parent, [ground, shown, this.textures], () => {
          const out = new Container()
          if (b === 0 && !apart) out.addChild(drawFlatGround(ground, this.kit.texture))
          out.addChild(drawCrispGround(this.kit, ground, keep(crispCells(groundOf, b))), drawCorners(this.kit, ground, keep(inBand(ground.corners))))
          return out
        })
        this.part(band.parts, `corner-shade-${tag}`, parent, [view.cells, ground, shown, this.shade.map], () => {
          const out = new Container()
          if (this.shade.map) out.addChild(drawShadeCorners(this.shade.map, keep(inBand(ground.corners)), (key) => cellByKey.get(key)))
          return out
        })
        this.part(band.parts, `cells-${tag}`, parent, [view.cells, view.rims, shown], () => drawCells(this.kit, keep(inBand(cellsOf)), view.hex))
        this.part(band.parts, `walls-${tag}`, parent, [ground, shown, this.textures], () => {
          const out = new Container()
          out.addChild(drawRidges(this.kit, keep(inBand(ground.ridges)), ground.faces, ground.front), drawChords(this.kit, keep(inBand(ground.chords))), drawSprites(this.kit, keep(inBand(ground.sprites))))
          return out
        })
        this.part(band.parts, `shade-${tag}`, parent, [view.cells, view.rims, ground, shown, this.shade.map], () => {
          const out = new Container()
          const cells = keep(inBand(cellsOf))
          if (this.shade.map) out.addChild(drawShadeOver(this.shade.map, cells, view.hex, { ridges: keep(inBand(ground.ridges)), chords: keep(inBand(ground.chords)), cellOf: (key) => cellByKey.get(key) }))
          out.addChild(drawMist(this.kit, cells, view.hex))
          return out
        })
      }
      if (!shown) for (const name of Object.keys(band.parts).filter((n) => n.endsWith('-veiled'))) {
        band.parts[name].object.destroy({ children: true })
        delete band.parts[name]
      }
    })
  }

  // ---------------------------------------------------------------------------
  // What is played

  // Where a token is drawn at a moment: along its walk, or where it was.
  private shownAt(id: string, now: number, fallback: Point): Point {
    const walk = this.walks.get(id)
    return walk ? alongWalk(walk, now) : fallback
  }

  // The motions and markers the view offers that have not been seen, set
  // going; a token the view has somewhere new with no motion to take it there
  // slides there, unless the whole board is being looked at another way.
  private queue(view: BoardView) {
    const now = performance.now()
    const playing = this.primed && !this.still
    const turned = this.lastFront !== null && this.lastFront !== view.front
    const tokens = new Map(view.tokens.map((t) => [t.id, t]))
    const started = new Set<string>()
    for (const m of view.motions) {
      if (this.played.has(m.key)) continue
      this.played.add(m.key)
      const token = tokens.get(m.id)
      if (!playing || turned || !token) continue
      const was = this.shownAt(m.id, now, this.lastAt.get(m.id) ?? m.steps[0])
      const steps = m.steps.slice(nearest(m.steps, was))
      const points: Point[] = steps.map((s) => ({ x: s.x, y: s.y }))
      const times: number[] = []
      steps.forEach((s, i) => times.push(i === 0 ? 0 : times[i - 1] + s.seconds * 1000))
      const end = points.at(-1)
      if (end && (end.x !== token.x || end.y !== token.y)) {
        points.push({ x: token.x, y: token.y })
        times.push((times.at(-1) ?? 0) + SLIDE_MS)
      }
      if (points.length < 2) continue
      this.walks.set(m.id, { points, times, start: now })
      started.add(m.id)
    }
    for (const t of view.tokens) {
      const was = this.lastAt.get(t.id)
      if (!was || started.has(t.id)) continue
      const at = this.shownAt(t.id, now, was)
      if (at.x === t.x && at.y === t.y) continue
      if (playing && !turned) this.walks.set(t.id, { points: [at, { x: t.x, y: t.y }], times: [0, SLIDE_MS], start: now })
      else this.walks.delete(t.id)
    }
    for (const m of view.markers) {
      if (this.played.has(m.key)) continue
      this.played.add(m.key)
      if (!this.primed || !tokens.has(m.id)) continue
      const start = this.floats.filter((f) => f.id === m.id).reduce((latest, f) => Math.max(latest, f.start + MARKER_GAP_MS), now)
      const node = drawMarker(this.kit, m)
      node.visible = false
      this.floatLayer.addChild(node)
      this.floats.push({ id: m.id, node, start })
    }
    for (const id of [...this.walks.keys()]) if (!tokens.has(id)) this.walks.delete(id)
    this.lastAt = new Map(view.tokens.map((t) => [t.id, { x: t.x, y: t.y }]))
    this.lastFront = view.front
    this.primed = true
  }

  // Every token on its way put where it is now, and every marker; whether
  // anything is still being played.
  private play(now: number): boolean {
    const tokens = new Map((this.drawn?.view.tokens ?? []).map((t) => [t.id, t]))
    for (const [id, node] of this.tokenNodes) {
      const walk = this.walks.get(id)
      const token = tokens.get(id)
      if (!walk || !token || now - walk.start >= (walk.times.at(-1) ?? 0)) {
        this.walks.delete(id)
        node.position.set(0, 0)
        continue
      }
      const at = alongWalk(walk, now)
      node.position.set(at.x - token.x, at.y - token.y)
    }
    this.floats = this.floats.filter((f) => {
      const token = tokens.get(f.id)
      const age = now - f.start
      if (!token || age >= MARKER_MS) {
        f.node.destroy({ children: true })
        return false
      }
      if (age < 0) return true
      const body = tokenBody(token)
      const offset = this.tokenNodes.get(f.id)?.position ?? { x: 0, y: 0 }
      const share = age / MARKER_MS
      f.node.visible = true
      f.node.position.set(body.x + offset.x, body.y + offset.y - body.radius - (this.still ? 0 : MARKER_RISE * share))
      f.node.alpha = share < 0.6 ? 1 : 1 - (share - 0.6) / 0.4
      return true
    })
    return this.walks.size > 0 || this.floats.length > 0
  }

  private drawLit() {
    if (!this.input) return
    this.litLayer.removeChildren().forEach((c) => c.destroy())
    this.litLayer.addChild(drawLit(this.kit, this.input.view, this.lit))
  }

  // The canvas drawn on the next frame, once however often it is asked; kept
  // drawing while a ring pulses or anything is played.
  private render() {
    if (this.frameRequest || !this.ready) return
    this.frameRequest = requestAnimationFrame((time) => {
      this.frameRequest = 0
      if (this.disposed) return
      const pulsing = !!this.drawn?.view.tokens.some((t) => t.awaited)
      if (this.awaited) this.awaited.alpha = pulsing ? 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / (PULSE_SECONDS * 1000)) : 1
      const playing = this.play(Math.max(time, performance.now()))
      this.app.render()
      if (pulsing || playing) this.render()
    })
  }

  // ---------------------------------------------------------------------------
  // Camera

  private place() {
    this.world.scale.set(this.camera.scale)
    this.world.position.set(this.camera.x, this.camera.y)
    this.blurs.forEach((filter, sigma) => { filter.strength = sigma * BLUR_PER_SIGMA * this.camera.scale })
    this.render()
  }

  private fit() {
    if (!this.input) return
    const { x, y, width, height } = this.input.view.frame
    const [w, h] = [this.app.screen.width, this.app.screen.height]
    const scale = Math.min(w / width, h / height)
    this.camera = { scale, fit: scale, x: (w - width * scale) / 2 - x * scale, y: (h - height * scale) / 2 - y * scale, zoomed: false }
    this.events.onZoomed?.(false)
    this.place()
  }

  private zoomAt(factor: number, at: Point) {
    const c = this.camera
    const scale = Math.min(c.fit * MAX_ZOOM, Math.max(c.fit * MIN_ZOOM, c.scale * factor))
    const k = scale / c.scale
    this.camera = { ...c, scale, x: at.x - (at.x - c.x) * k, y: at.y - (at.y - c.y) * k, zoomed: true }
    this.events.onZoomed?.(true)
    this.place()
  }

  zoomIn() { this.zoomAt(ZOOM_STEP, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }) }
  zoomOut() { this.zoomAt(1 / ZOOM_STEP, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }) }
  reset() { this.fit() }

  private onResize() {
    const [w, h] = [Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight)]
    if (w === this.app.screen.width && h === this.app.screen.height) return
    this.app.renderer.resize(w, h)
    if (this.camera.zoomed) this.render()
    else this.fit()
  }

  // ---------------------------------------------------------------------------
  // The pointer

  private local(e: { clientX: number; clientY: number }): Point {
    const box = this.app.canvas.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  private toWorld(p: Point): Point {
    return { x: (p.x - this.camera.x) / this.camera.scale, y: (p.y - this.camera.y) / this.camera.scale }
  }

  // What lies under a point of the canvas, topmost first: an item on the
  // floor, a character, a cell.
  private hit(p: Point): { kind: 'floor'; itemId: string } | { kind: 'token'; token: BoardTokenView } | { kind: 'cell'; cell: BoardCellView } | null {
    const view = this.input?.view
    if (!view) return null
    const w = this.toWorld(p)
    if (this.events.onFloorItem) {
      const item = [...view.floor].reverse().find((f) => Math.abs(w.x - f.x) <= FLOOR_ITEM_HALF && Math.abs(w.y - f.y) <= FLOOR_ITEM_HALF)
      if (item) return { kind: 'floor', itemId: item.itemId }
    }
    if (this.events.onToken) {
      const token = [...view.tokens].reverse().find((t) => {
        const body = tokenBody(t)
        return Math.hypot(w.x - body.x, w.y - body.y) <= body.radius
      })
      if (token) return { kind: 'token', token }
    }
    const cell = this.events.cellAt(view, w)
    return cell ? { kind: 'cell', cell } : null
  }

  private hover(p: Point | null) {
    const found = p ? this.hit(p) : null
    const lit = found?.kind === 'cell' ? found.cell.key : null
    const item = found?.kind === 'floor' ? found.itemId : null
    this.app.canvas.style.cursor = found ? 'pointer' : 'default'
    if (lit !== this.lit) { this.lit = lit; this.drawLit(); this.render() }
    if (item !== this.hoveredItem) { this.hoveredItem = item; this.sync() }
    const said = !found || !p ? '' : found.kind === 'cell' ? `cell:${found.cell.key}` : found.kind === 'token' ? `token:${found.token.id}` : `floor:${found.itemId}`
    if (said === this.hovered) return
    this.hovered = said
    this.events.onHover?.(!found || !p ? null
      : found.kind === 'cell' ? { kind: 'cell', key: found.cell.key, ...p }
      : found.kind === 'token' ? { kind: 'token', id: found.token.id, ...p }
      : { kind: 'floor', itemId: found.itemId, ...p })
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 1) e.preventDefault()
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, camera: { x: this.camera.x, y: this.camera.y }, panning: false }
  }

  private onPointerMove = (e: PointerEvent) => {
    const press = this.press
    if (!press || press.id !== e.pointerId) { this.hover(this.local(e)); return }
    const [dx, dy] = [e.clientX - press.x, e.clientY - press.y]
    if (!press.panning) {
      if (Math.hypot(dx, dy) < PAN_SLOP) return
      press.panning = true
      this.app.canvas.setPointerCapture(e.pointerId)
      this.app.canvas.style.cursor = 'grabbing'
      this.hovered = ''
      this.events.onHover?.(null)
    }
    this.camera = { ...this.camera, x: press.camera.x + dx, y: press.camera.y + dy, zoomed: true }
    this.events.onZoomed?.(true)
    this.place()
  }

  private onPointerUp = (e: PointerEvent) => {
    const press = this.press
    if (!press || press.id !== e.pointerId) return
    this.press = null
    if (press.panning) { this.hover(this.local(e)); return }
    if (e.button !== 0) return
    const found = this.hit(this.local(e))
    if (found?.kind === 'floor') this.events.onFloorItem?.(found.itemId)
    else if (found?.kind === 'token') this.events.onToken?.(found.token.id)
    else if (found?.kind === 'cell') this.events.onCell?.(found.cell.cell)
  }

  private onPointerCancel = () => { this.press = null }

  private onPointerLeave = () => { if (!this.press) this.hover(null) }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, this.local(e))
  }

  setEvents(events: BoardEvents) {
    this.events = events
  }
}

// Where along its walk a token is at a moment: setting off and coming to a
// stop eased, at an even pace between.
function alongWalk(walk: Walk, now: number): Point {
  const t = now - walk.start
  const { points, times } = walk
  if (t <= 0) return points[0]
  const last = points.length - 1
  for (let i = 1; i <= last; i++) {
    if (t > times[i]) continue
    const span = times[i] - times[i - 1]
    const k = span <= 0 ? 1 : (t - times[i - 1]) / span
    const eased = last === 1 ? k * k * (3 - 2 * k) : i === 1 ? setOff(k) : i === last ? 1 - setOff(1 - k) : k
    return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * eased, y: points[i - 1].y + (points[i].y - points[i - 1].y) * eased }
  }
  return points[last]
}

// From standing still to the even pace over one stretch.
const setOff = (k: number) => 2 * k * k - k * k * k

// The step of a walk nearest a place, the first of those as near.
function nearest(steps: readonly Point[], at: Point): number {
  const away = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y)
  return steps.reduce((best, s, i) => (away(s) < away(steps[best]) - 1e-6 ? i : best), 0)
}
