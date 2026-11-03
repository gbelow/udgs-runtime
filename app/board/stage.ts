import { AlphaFilter, Application, BlurFilter, Container, type Graphics } from 'pixi.js'
import type { BoardCellView, BoardTokenView, BoardView } from '../domain/scene/projections/boardView'
import type { Coord } from '../domain/scene/types'
import type { Point } from '../domain/scene/rules/board/geometry'
import { readPalette } from './palette'
import { getTexture } from './textures'
import { drawFlatGround } from './ground'
import { FLOOR_ITEM_HALF, crispCells, drawAwaited, drawCorners, drawBinds, drawCells, drawChords, drawCrispGround, drawFloor, drawGhosts, drawLit, drawMist, drawOverhead, drawRidges, drawSprites, drawToken, tokenBody, type Kit } from './draw'
import { drawShadeCorners, drawShadeMap, drawShadeOver, type ShadeMap } from './light'

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

type Part = { deps: unknown[]; object: Container }
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
  private camera = { scale: 1, x: 0, y: 0, zoomed: false, fit: 1 }
  private framed = ''
  private frameRequest = 0
  private press: { id: number; x: number; y: number; camera: { x: number; y: number }; panning: boolean } | null = null
  private resize: ResizeObserver | null = null

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
    this.world.addChild(this.bandLayer, this.litLayer, this.top)
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
    this.shade.map?.destroy()
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
    const old = sameDeps(this.shade.deps, shadeDeps) ? null : this.shade.map
    if (!sameDeps(this.shade.deps, shadeDeps)) this.shade = { deps: shadeDeps, map: drawShadeMap(this.app.renderer, view.cells, view.chords, view.lights) }
    this.syncBands(view, veiled)
    old?.destroy()
    const top = this.top
    top.removeChildren()
    this.part(this.parts, 'overhead', top, [view.ground.overhead, view.hex, this.textures], () => drawOverhead(this.kit, view.ground.overhead, view.hex))
    this.part(this.parts, 'tokens', top, [view.tokens, view.hex, picked, this.textures], () => {
      const out = new Container()
      view.tokens.forEach((t) => out.addChild(drawToken(this.kit, t, view.hex, picked.includes(t.id))))
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

  private drawLit() {
    if (!this.input) return
    this.litLayer.removeChildren().forEach((c) => c.destroy())
    this.litLayer.addChild(drawLit(this.kit, this.input.view, this.lit))
  }

  // The canvas drawn on the next frame, once however often it is asked; kept
  // drawing while a ring pulses.
  private render() {
    if (this.frameRequest || !this.ready) return
    this.frameRequest = requestAnimationFrame((time) => {
      this.frameRequest = 0
      if (this.disposed) return
      const pulsing = !!this.drawn?.view.tokens.some((t) => t.awaited)
      if (this.awaited) this.awaited.alpha = pulsing ? 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / (PULSE_SECONDS * 1000)) : 1
      this.app.render()
      if (pulsing) this.render()
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
