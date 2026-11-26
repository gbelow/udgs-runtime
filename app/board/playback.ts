import { Container, Graphics } from 'pixi.js'
import type { BoardBindView, BoardTokenView, BoardView } from '../domain/scene/projections/boardView'
import type { BoardPosture } from '../domain/scene/projections/boardMotion'
import type { Point } from '../domain/scene/rules/board/geometry'
import { FIGURE, POSTURES, colorOf, drawBinds, drawMarker, tokenBody, type Kit } from './draw'

// What the board plays as the fight goes on, from what the view offers: the
// walks of the moves that landed, the blows (the striker lunges, whoever it
// got through to shakes), the streaks of shots and spells, the flash of an
// area going off, a faller's drop, a token easing into how it now lies, and
// the markers rising off whoever an action reached. One after another in the
// order the actions landed, never behind by more than a moment; nothing the
// fight decides waits on it. What the first view offers is taken as seen.

// How fast the viewer has the board play it, or not at all; kept in the browser.
export type BoardMotion = 'normal' | 'fast' | 'off'
const PACE: Record<BoardMotion, number> = { normal: 1, fast: 2, off: 0 }

// how long each thing plays, in milliseconds at the normal pace, and how far
// it goes, in board units
const SLIDE_MS = 250
const LUNGE_MS = 320
const LUNGE = 0.35
const SHAKE_MS = 300
const SHAKE = 0.1
const SHOT_MS = 260
const SPELL_MS = 420
const AREA_MS = 650
// how long an area holds up what comes after it
const AREA_HOLD_MS = 200
const DROP_MS = 320
const DROP = 0.7
const POSE_MS = 350
const JUMP_LIFT = 0.6
const MARKER_MS = 1400
const MARKER_RISE = 0.9
const MARKER_GAP_MS = 400
// what is played gives up waiting its turn once it would start this late
const MOST_BEHIND_MS = 2500

// A token on its way: the places it passes, and when it is at each, in
// milliseconds from `start`; a jump goes up and comes down on the way.
type Walk = { points: Point[]; times: number[]; start: number; jump: boolean }
type Nudge = { id: string; kind: 'lunge' | 'shake' | 'drop'; start: number; ms: number; dir: Point }
type Streak = { kind: 'shot' | 'spell'; from: string; to: string | Point; start: number; ms: number }
type Flash = { cells: Point[]; start: number; ms: number }
type Pose = { from: { x: number; y: number }; start: number; ms: number }
type Float = { id: string; node: Container; start: number; still: boolean }

// What the stage hands over each frame: the token drawn for each character,
// the awaited rings (one to each, named by id) and the links between tokens.
export type PlayedNodes = { tokens: ReadonlyMap<string, Container>; awaited: Container | null; binds: Container | null }

export class Playback {
  // streaks and flashes, under the markers rising
  readonly fx = new Container()
  readonly floats = new Container()
  private strokes = new Graphics()
  private movingBinds: Graphics | null = null
  private played = new Set<string>()
  private primed = false
  private reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  private pace = this.reduced ? 0 : 1
  private cursor = 0
  private walks = new Map<string, Walk>()
  private nudges: Nudge[] = []
  private streaks: Streak[] = []
  private flashes: Flash[] = []
  private poses = new Map<string, Pose>()
  private floatList: Float[] = []
  private lastAt = new Map<string, Point>()
  private lastPosture = new Map<string, BoardPosture>()
  private lastFront: boolean | null = null

  constructor(private kit: Kit) {
    this.fx.addChild(this.strokes)
  }

  setMotion(motion: BoardMotion) {
    this.pace = this.reduced ? 0 : PACE[motion]
  }

  // When what has been given is played out: the last of what waits its turn,
  // and every walk.
  get busyUntil(): number {
    let until = this.cursor
    for (const w of this.walks.values()) until = Math.max(until, w.start + (w.times.at(-1) ?? 0))
    return until
  }

  // How long something that takes `ms` at the normal pace takes now.
  paced(ms: number): number {
    return this.ms(ms)
  }

  private ms(ms: number): number {
    return this.pace > 0 ? ms / this.pace : 0
  }

  // When something taking `ms` starts: once what is before it has played.
  private slot(now: number, ms: number): number {
    if (this.cursor > now + MOST_BEHIND_MS) this.cursor = now
    const start = Math.max(now, this.cursor)
    this.cursor = start + ms
    return start
  }

  // Where a token is drawn at a moment: along its walk, or where it was.
  private shownAt(id: string, now: number, fallback: Point): Point {
    const walk = this.walks.get(id)
    return walk ? alongWalk(walk, now).at : fallback
  }

  // What the view offers that has not been seen, set going in the order it
  // landed; a token the view has somewhere new with nothing to take it there
  // slides there, and one that lies another way eases into it, unless the
  // whole board is being looked at another way.
  queue(view: BoardView, now: number) {
    const playing = this.primed && this.pace > 0 && (this.lastFront === null || this.lastFront === view.front)
    const tokens = new Map(view.tokens.map((t) => [t.id, t]))
    const fresh: { order: number; rank: number; run: () => void }[] = []
    const take = (key: string, order: number, rank: number, run: () => void) => {
      if (this.played.has(key)) return
      this.played.add(key)
      if (this.primed) fresh.push({ order, rank, run })
    }
    const walked = new Set<string>()
    for (const m of view.motions) take(`walk:${m.key}`, m.order, 0, () => {
      const token = tokens.get(m.id)
      if (!playing || !token) return
      const was = this.shownAt(m.id, now, this.lastAt.get(m.id) ?? m.steps[0])
      const steps = m.steps.slice(nearest(m.steps, was))
      const points: Point[] = steps.map((s) => ({ x: s.x, y: s.y }))
      const times: number[] = []
      steps.forEach((s, i) => times.push(i === 0 ? 0 : times[i - 1] + this.ms(s.seconds * 1000)))
      const end = points.at(-1)
      if (end && (end.x !== token.x || end.y !== token.y)) {
        points.push({ x: token.x, y: token.y })
        times.push((times.at(-1) ?? 0) + this.ms(SLIDE_MS))
      }
      if (points.length < 2) return
      this.walks.set(m.id, { points, times, start: this.slot(now, times.at(-1) ?? 0), jump: m.jump })
      walked.add(m.id)
    })
    for (const x of view.strikes) take(`strike:${x.key}`, x.order, 1, () => {
      if (!playing) return
      const actor = tokens.get(x.actor)
      const ends: (string | Point)[] = [...x.targets.filter((id) => tokens.has(id)), ...(x.at ? [x.at] : [])]
      const shake = (start: number) => { if (x.hit) for (const id of x.targets) this.nudges.push({ id, kind: 'shake', start, ms: this.ms(SHAKE_MS), dir: { x: 1, y: 0 } }) }
      if (x.kind === 'melee' && actor) {
        const target = tokens.get(x.targets[0] ?? '')
        if (!target) return
        const [a, b] = [tokenBody(actor), tokenBody(target)]
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const start = this.slot(now, this.ms(LUNGE_MS))
        this.nudges.push({ id: x.actor, kind: 'lunge', start, ms: this.ms(LUNGE_MS), dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length } })
        shake(start + this.ms(LUNGE_MS) / 2)
      } else if ((x.kind === 'shot' || x.kind === 'spell') && actor && ends.length > 0) {
        const ms = this.ms(x.kind === 'shot' ? SHOT_MS : SPELL_MS)
        const start = this.slot(now, ms)
        for (const to of ends) this.streaks.push({ kind: x.kind, from: x.actor, to, start, ms })
        shake(start + ms)
      } else if (x.kind === 'area' && x.cells.length > 0) {
        this.flashes.push({ cells: x.cells, start: this.slot(now, this.ms(AREA_HOLD_MS)), ms: this.ms(AREA_MS) })
      } else if (x.kind === 'drop' && actor) {
        this.nudges.push({ id: x.actor, kind: 'drop', start: this.slot(now, this.ms(DROP_MS)), ms: this.ms(DROP_MS), dir: { x: 0, y: -1 } })
      }
    })
    for (const m of view.markers) take(`marker:${m.key}`, m.order, 2, () => {
      if (!tokens.has(m.id)) return
      const after = playing ? Math.max(now, this.cursor) : now
      const start = this.floatList.filter((f) => f.id === m.id).reduce((latest, f) => Math.max(latest, f.start + MARKER_GAP_MS), after)
      const node = drawMarker(this.kit, m)
      node.visible = false
      this.floats.addChild(node)
      this.floatList.push({ id: m.id, node, start, still: !playing })
    })
    fresh.sort((a, b) => a.order - b.order || a.rank - b.rank).forEach((f) => f.run())

    for (const t of view.tokens) {
      const was = this.lastAt.get(t.id)
      if (was && !walked.has(t.id)) {
        const at = this.shownAt(t.id, now, was)
        if (at.x !== t.x || at.y !== t.y) {
          if (playing) this.walks.set(t.id, { points: [at, { x: t.x, y: t.y }], times: [0, this.ms(SLIDE_MS)], start: now, jump: false })
          else this.walks.delete(t.id)
        }
      }
      const lay = this.lastPosture.get(t.id)
      if (playing && lay && lay !== t.posture) this.poses.set(t.id, { from: POSTURES[lay], start: Math.max(now, this.cursor), ms: this.ms(POSE_MS) })
    }
    for (const id of [...this.walks.keys()]) if (!tokens.has(id)) this.walks.delete(id)
    this.lastAt = new Map(view.tokens.map((t) => [t.id, { x: t.x, y: t.y }]))
    this.lastPosture = new Map(view.tokens.map((t) => [t.id, t.posture]))
    this.lastFront = view.front
    this.primed = true
  }

  // Everything put where it is at `now`; whether anything is still playing.
  frame(now: number, view: BoardView | undefined, nodes: PlayedNodes): boolean {
    const tokens = new Map((view?.tokens ?? []).map((t) => [t.id, t]))
    const offsets = new Map<string, Point>()
    for (const [id, token] of tokens) {
      const off = { x: 0, y: 0 }
      const walk = this.walks.get(id)
      if (walk) {
        const { at, share } = alongWalk(walk, now)
        off.x += at.x - token.x
        off.y += at.y - token.y
        if (walk.jump && share > 0 && share < 1) off.y -= JUMP_LIFT * Math.sin(Math.PI * share)
        if (now - walk.start >= (walk.times.at(-1) ?? 0)) this.walks.delete(id)
      }
      for (const n of this.nudges) {
        if (n.id !== id) continue
        const k = (now - n.start) / (n.ms || 1)
        if (k <= 0 || k >= 1) continue
        if (n.kind === 'lunge') { off.x += n.dir.x * LUNGE * Math.sin(Math.PI * k); off.y += n.dir.y * LUNGE * Math.sin(Math.PI * k) }
        else if (n.kind === 'shake') off.x += SHAKE * Math.sin(6 * Math.PI * k) * (1 - k)
        else off.y -= DROP * (1 - k * k)
      }
      offsets.set(id, off)
    }
    this.nudges = this.nudges.filter((n) => now < n.start + n.ms)

    for (const [id, node] of nodes.tokens) {
      const off = offsets.get(id) ?? { x: 0, y: 0 }
      node.position.set(off.x, off.y)
      const figure = node.getChildByLabel(FIGURE, true)
      const token = tokens.get(id)
      const pose = this.poses.get(id)
      if (figure && token) {
        const to = POSTURES[token.posture]
        const k = pose ? Math.min(1, Math.max(0, (now - pose.start) / (pose.ms || 1))) : 1
        const from = pose?.from ?? to
        figure.scale.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
        if (k >= 1) this.poses.delete(id)
      }
    }
    for (const ring of nodes.awaited?.children ?? []) {
      const off = offsets.get(ring.label) ?? { x: 0, y: 0 }
      ring.position.set(off.x, off.y)
    }
    this.moveBinds(view?.binds ?? [], offsets, nodes.binds)
    this.drawStrokes(now, view, tokens, offsets)
    this.rise(now, tokens, offsets)
    return this.walks.size > 0 || this.nudges.length > 0 || this.streaks.length > 0 || this.flashes.length > 0 || this.poses.size > 0 || this.floatList.length > 0
  }

  // A link between two tokens follows them while either is drawn off its place.
  private moveBinds(binds: BoardBindView[], offsets: Map<string, Point>, drawn: Container | null) {
    const off = (id: string) => offsets.get(id) ?? { x: 0, y: 0 }
    const moving = binds.some((b) => b.ids.some((id) => off(id).x !== 0 || off(id).y !== 0))
    this.movingBinds?.destroy()
    this.movingBinds = null
    if (drawn) drawn.visible = !moving
    if (!moving) return
    const shifted = binds.map((b) => ({ ...b, from: { x: b.from.x + off(b.ids[0]).x, y: b.from.y + off(b.ids[0]).y }, to: { x: b.to.x + off(b.ids[1]).x, y: b.to.y + off(b.ids[1]).y } }))
    this.movingBinds = drawBinds(this.kit, shifted)
    this.fx.addChild(this.movingBinds)
  }

  private drawStrokes(now: number, view: BoardView | undefined, tokens: Map<string, BoardTokenView>, offsets: Map<string, Point>) {
    const g = this.strokes.clear()
    const centre = (to: string | Point): Point | null => {
      if (typeof to !== 'string') return to
      const token = tokens.get(to)
      if (!token) return null
      const body = tokenBody(token)
      const off = offsets.get(to) ?? { x: 0, y: 0 }
      return { x: body.x + off.x, y: body.y + off.y }
    }
    const along = (a: Point, b: Point, k: number): Point => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
    this.streaks = this.streaks.filter((s) => {
      const k = (now - s.start) / (s.ms || 1)
      if (k >= 1) return false
      const [a, b] = [centre(s.from), centre(s.to)]
      if (k <= 0 || !a || !b) return true
      if (s.kind === 'shot') {
        const [tail, head] = [along(a, b, Math.max(0, k - 0.35)), along(a, b, k)]
        g.moveTo(tail.x, tail.y).lineTo(head.x, head.y).stroke({ width: 0.07, cap: 'round', ...colorOf(this.kit, { color: 'fg' }) })
      } else {
        const head = along(a, b, Math.min(1, k * 1.6))
        g.moveTo(a.x, a.y).lineTo(head.x, head.y).stroke({ width: 0.1, cap: 'round', ...colorOf(this.kit, { color: 'accent', alpha: 1 - 0.6 * k }) })
        if (k > 0.5) g.circle(b.x, b.y, 0.3 + 1.2 * (k - 0.5)).stroke({ width: 0.08, ...colorOf(this.kit, { color: 'accent', alpha: 2 * (1 - k) }) })
      }
      return true
    })
    const hex = view?.hex ?? []
    this.flashes = this.flashes.filter((f) => {
      const k = (now - f.start) / (f.ms || 1)
      if (k >= 1) return false
      if (k <= 0) return true
      for (const c of f.cells) g.poly(hex.flatMap((p) => [p.x + c.x, p.y + c.y])).fill(colorOf(this.kit, { color: 'accent', alpha: 0.5 * (1 - k) }))
      return true
    })
  }

  private rise(now: number, tokens: Map<string, BoardTokenView>, offsets: Map<string, Point>) {
    this.floatList = this.floatList.filter((f) => {
      const token = tokens.get(f.id)
      const age = now - f.start
      if (!token || age >= MARKER_MS) {
        f.node.destroy({ children: true })
        return false
      }
      if (age < 0) return true
      const body = tokenBody(token)
      const off = offsets.get(f.id) ?? { x: 0, y: 0 }
      const share = age / MARKER_MS
      f.node.visible = true
      f.node.position.set(body.x + off.x, body.y + off.y - body.radius - (f.still ? 0 : MARKER_RISE * share))
      f.node.alpha = share < 0.6 ? 1 : 1 - (share - 0.6) / 0.4
      return true
    })
  }

  dispose() {
    this.movingBinds?.destroy()
  }
}

// Where along its walk a token is at a moment, and how much of the walk is
// behind it: setting off and coming to a stop eased, at an even pace between.
function alongWalk(walk: Walk, now: number): { at: Point; share: number } {
  const t = now - walk.start
  const { points, times } = walk
  const last = points.length - 1
  const total = times[last] || 1
  if (t <= 0) return { at: points[0], share: 0 }
  for (let i = 1; i <= last; i++) {
    if (t > times[i]) continue
    const span = times[i] - times[i - 1]
    const k = span <= 0 ? 1 : (t - times[i - 1]) / span
    const eased = last === 1 ? k * k * (3 - 2 * k) : i === 1 ? setOff(k) : i === last ? 1 - setOff(1 - k) : k
    return { at: { x: points[i - 1].x + (points[i].x - points[i - 1].x) * eased, y: points[i - 1].y + (points[i].y - points[i - 1].y) * eased }, share: t / total }
  }
  return { at: points[last], share: 1 }
}

// From standing still to the even pace over one stretch.
const setOff = (k: number) => 2 * k * k - k * k * k

// The step of a walk nearest a place, the first of those as near.
function nearest(steps: readonly Point[], at: Point): number {
  const away = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y)
  return steps.reduce((best, s, i) => (away(s) < away(steps[best]) - 1e-6 ? i : best), 0)
}
