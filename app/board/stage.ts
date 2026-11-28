import { AlphaFilter, Application, BlurFilter, ColorMatrixFilter, Container } from 'pixi.js'
import type { BoardCellView, BoardTokenView, BoardView } from '../domain/scene/projections/boardView'
import type { Coord } from '../domain/scene/types'
import type { Point } from '../domain/scene/rules/board/geometry'
import { readPalette } from './palette'
import { getTexture } from './textures'
import { drawFlatGround } from './ground'
import { FLOOR_ITEM_HALF, crispCells, drawAwaited, drawCorners, drawBinds, drawCells, drawChords, drawCrispGround, drawFloor, drawGhosts, drawLit, drawMarked, drawMist, drawOverhead, drawRidges, drawSprites, drawToken, tokenBody, type Kit } from './draw'
import { Playback, type BoardMotion } from './playback'
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
  // the cells kept lit while the popover is open on them
  marked: readonly string[]
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
  // when what the board has been given will have been played (`performance.now()`)
  onPlaying?: (until: number) => void
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
// how wide a hex is drawn by default, in the canvas's pixels: close enough
// for the art on a token to read
const CLOSE_HEX_PX = 70
// how long the camera takes to glide to whoever comes to hold the turn
const GLIDE_MS = 200

type Part = { deps: unknown[]; object: Container }
type Band = { root: Container; normal: Container; veiled: Container; parts: Record<string, Part> }

const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

// Whoever holds the turn, where they are drawn in sight on this floor.
const inTurn = (view: BoardView) => view.tokens.find((t) => t.isInTurn && !t.heard && !t.elsewhere)

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
  private awaited: Container | null = null
  private lit: string | null = null
  private hoveredItem: string | null = null
  private textures = 0
  private blurs = new Map<number, BlurFilter>()
  private fades = new Map<number, AlphaFilter>()
  private dims = new Map<'grey' | 'dark', ColorMatrixFilter>()
  private kit: Kit
  private shade: { deps: unknown[]; map: ShadeMap | null } = { deps: [], map: null }
  private shadeTargets = makeShadeTargets()
  private camera = { scale: 1, x: 0, y: 0, zoomed: false, fit: 1 }
  // where the camera glides to, from where, and when
  private glide: { from: Point; to: Point; start: number; end: number } | null = null
  // the one holding the turn the camera last went to
  private followed: string | null = null
  private framed = ''
  private frameRequest = 0
  private press: { id: number; x: number; y: number; camera: { x: number; y: number }; panning: boolean } | null = null
  private resize: ResizeObserver | null = null

  // the token drawn for each character, and what the board plays over them
  private tokenNodes = new Map<string, Container>()
  private playback: Playback

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
      dim: (look) => {
        let filter = this.dims.get(look)
        if (!filter) {
          filter = new ColorMatrixFilter()
          if (look === 'grey') filter.greyscale(0.45, false)
          else filter.brightness(0.55, false)
          this.dims.set(look, filter)
        }
        return filter
      },
    }
    this.playback = new Playback(this.kit)
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
    this.world.addChild(this.bandLayer, this.litLayer, this.top, this.playback.fx, this.playback.floats)
    this.app.stage.addChild(this.world)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    // the right button is the board's own: the browser's menu never opens over it
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.resize = new ResizeObserver(() => this.onResize())
    this.resize.observe(this.host)
    this.ready = true
    this.sync()
  }

  // How fast the board plays what happens, or not at all.
  setMotion(motion: BoardMotion) {
    this.playback.setMotion(motion)
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
    this.dims.forEach((f) => f.destroy())
    this.playback.dispose()
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
    this.playback.queue(view, performance.now())
    this.follow(view)
    this.events.onPlaying?.(Math.max(this.playback.busyUntil, this.glide?.end ?? 0))
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
    this.awaited = this.parts.awaited.object
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

  private drawLit() {
    if (!this.input) return
    this.litLayer.removeChildren().forEach((c) => c.destroy())
    this.litLayer.addChild(drawMarked(this.kit, this.input.view, this.input.marked), drawLit(this.kit, this.input.view, this.lit))
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
      const now = Math.max(time, performance.now())
      const gliding = this.stepGlide(now)
      const playing = this.playback.frame(now, this.drawn?.view, { tokens: this.tokenNodes, awaited: this.awaited, binds: this.parts.binds?.object ?? null })
      this.app.render()
      if (pulsing || playing || gliding) this.render()
    })
  }

  // ---------------------------------------------------------------------------
  // Camera

  private place() {
    this.applyCamera()
    this.render()
  }

  private applyCamera() {
    this.world.scale.set(this.camera.scale)
    this.world.position.set(this.camera.x, this.camera.y)
    this.blurs.forEach((filter, sigma) => { filter.strength = sigma * BLUR_PER_SIGMA * this.camera.scale })
  }

  // The scale at which the whole board fits the canvas, and at which a hex is
  // drawn `CLOSE_HEX_PX` wide.
  private scales(): { whole: number; close: number } {
    const view = this.input!.view
    const { width, height } = view.frame
    const xs = view.hex.map((p) => p.x)
    const hex = xs.length > 0 ? Math.max(...xs) - Math.min(...xs) : 0
    const whole = Math.min(this.app.screen.width / width, this.app.screen.height / height)
    return { whole, close: hex > 0 ? CLOSE_HEX_PX / hex : whole }
  }

  // Where the camera stands to put a point of the board in the canvas's middle
  // at `scale`, moved off it as far as it takes to keep the board filling the
  // canvas: no edge of the board is pulled in past the canvas's edge while
  // the board is wider (or taller) than the canvas, and a board narrower
  // (or shorter) than it sits in its middle.
  private centred(at: Point, scale: number): Point {
    const { width, height } = this.app.screen
    const frame = this.input?.view.frame
    const want = { x: width / 2 - at.x * scale, y: height / 2 - at.y * scale }
    if (!frame) return want
    const keep = (aim: number, screen: number, start: number, size: number) => {
      const drawn = size * scale
      if (drawn <= screen) return (screen - drawn) / 2 - start * scale
      return Math.min(-start * scale, Math.max(screen - (start + size) * scale, aim))
    }
    return { x: keep(want.x, width, frame.x, frame.width), y: keep(want.y, height, frame.y, frame.height) }
  }

  private setCamera(scale: number, at: Point) {
    this.glide = null
    const zoomed = scale > this.camera.fit * 1.001
    this.camera = { ...this.camera, scale, ...this.centred(at, scale), zoomed }
    this.events.onZoomed?.(zoomed)
    this.place()
  }

  // The whole board in the canvas.
  private fitWhole() {
    if (!this.input) return
    const { x, y, width, height } = this.input.view.frame
    const { whole } = this.scales()
    this.camera = { ...this.camera, fit: whole }
    this.setCamera(whole, { x: x + width / 2, y: y + height / 2 })
  }

  // The board as it is first seen: close, on whoever holds the turn if they
  // are seen, else on whoever is picked, or the whole of it where that is
  // closer still.
  private fit() {
    if (!this.input) return
    const view = this.input.view
    const { whole, close } = this.scales()
    this.camera = { ...this.camera, fit: whole }
    const holder = inTurn(view)
    this.followed = holder?.id ?? null
    const on = holder ?? view.tokens.find((t) => t.isActive && !t.heard)
    if (close <= whole || !on) return this.fitWhole()
    this.setCamera(close, tokenBody(on))
  }

  // The camera glides to whoever comes to hold the turn, once the board has
  // played what came before, unless the whole board is in sight or they are
  // not. A character who drops out of sight and back is gone to again.
  private follow(view: BoardView) {
    const holder = inTurn(view)
    if (holder?.id === this.followed) return
    this.followed = holder?.id ?? null
    if (!holder || !this.camera.zoomed) return
    const body = tokenBody(holder)
    const to = this.centred(body, this.camera.scale)
    if (!this.nearer(body, { ...to, scale: this.camera.scale })) return
    const ms = this.playback.paced(GLIDE_MS)
    if (ms === 0) {
      this.glide = null
      this.camera = { ...this.camera, ...to }
      this.place()
      return
    }
    const start = Math.max(performance.now(), this.playback.busyUntil)
    this.glide = { from: { x: this.camera.x, y: this.camera.y }, to, start, end: start + ms }
    this.render()
  }

  // The glide moved on to `now`; whether it is still under way.
  private stepGlide(now: number): boolean {
    const g = this.glide
    if (!g) return false
    if (now < g.start) return true
    const t = Math.min(1, (now - g.start) / (g.end - g.start))
    const k = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2
    this.camera = { ...this.camera, x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k }
    this.applyCamera()
    if (t < 1) return true
    this.glide = null
    return false
  }

  // Where on the screen a character is drawn, and how wide.
  screenOf(id: string): { x: number; y: number; radius: number } | null {
    const t = this.input?.view.tokens.find((x) => x.id === id)
    if (!t) return null
    const body = tokenBody(t)
    const box = this.app.canvas.getBoundingClientRect()
    const { x, y, scale } = this.camera
    return { x: box.left + x + body.x * scale, y: box.top + y + body.y * scale, radius: body.radius * scale }
  }

  // The camera snapped to a character, at least as close as by default,
  // only where that brings them nearer the canvas's middle than they are.
  lookAt(id: string) {
    const t = this.input?.view.tokens.find((x) => x.id === id)
    if (!t) return
    const body = tokenBody(t)
    const scale = Math.max(this.camera.scale, this.scales().close)
    if (this.nearer(body, { ...this.centred(body, scale), scale })) this.setCamera(scale, body)
  }

  // Whether the camera at `to` draws the point `at` nearer the canvas's
  // middle than the camera does now, by more than a pixel.
  private nearer(at: Point, to: { x: number; y: number; scale: number }): boolean {
    const { width, height } = this.app.screen
    const off = (c: { x: number; y: number; scale: number }) => Math.hypot(c.x + at.x * c.scale - width / 2, c.y + at.y * c.scale - height / 2)
    return off(to) < off(this.camera) - 1
  }

  private zoomAt(factor: number, at: Point) {
    this.glide = null
    const c = this.camera
    const scale = Math.min(c.fit * MAX_ZOOM, Math.max(c.fit * MIN_ZOOM, c.scale * factor))
    const k = scale / c.scale
    this.camera = { ...c, scale, x: at.x - (at.x - c.x) * k, y: at.y - (at.y - c.y) * k, zoomed: true }
    this.events.onZoomed?.(true)
    this.place()
  }

  zoomIn() { this.zoomAt(ZOOM_STEP, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }) }
  zoomOut() { this.zoomAt(1 / ZOOM_STEP, { x: this.app.screen.width / 2, y: this.app.screen.height / 2 }) }
  reset() { this.fitWhole() }

  private onResize() {
    const [w, h] = [Math.max(1, this.host.clientWidth), Math.max(1, this.host.clientHeight)]
    if (w === this.app.screen.width && h === this.app.screen.height) return
    this.app.renderer.resize(w, h)
    if (!this.input) return
    if (this.camera.zoomed) {
      this.camera = { ...this.camera, fit: this.scales().whole }
      this.render()
    }
    else this.fitWhole()
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
      this.glide = null
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

