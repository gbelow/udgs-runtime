import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { SHAPES, faceUp, makeMesh, turnOnto, type DieKind, type Look } from './shapes'

// The dice tray: a box the dice are thrown into. The faces are known before
// the throw; the throw is played out in full first, out of sight, and each die
// is then drawn turned by one of its own turns so the face it lands on shows
// the face it was given. How the dice are flung changes how they fly, never
// what they show.

export type TrayDie = { kind: DieKind; value: number; tag: number }
// A fling: where the hand let go, and how fast it was moving, in the tray.
export type Fling = { from: THREE.Vector3; velocity: THREE.Vector3 }

const LOOKS: Record<DieKind, Look> = {
  d10: { body: '#e7dcc4', ink: '#2a2118' },
  d6: { body: '#7a2424', ink: '#f3e9d8' },
}

const STEP = 1 / 60
const MAX_STEPS = 60 * 7
const W = 4.2
const D = 2.6
const HAND = 2.2
const MIN_SPEED = 7
const MAX_SPEED = 22
const TWIRL = new THREE.Vector3(1, 1, 0).normalize()

type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion }
type Placed = Pose & { mesh: THREE.Mesh; kind: DieKind; tag: number }
type Track = { frames: Float32Array; steps: number }

let ready: Promise<void> | null = null
const init = () => (ready ??= RAPIER.init())

const randomRotation = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2))

const clampToTray = (v: THREE.Vector3) => {
  v.x = THREE.MathUtils.clamp(v.x, -W + 0.6, W - 0.6)
  v.z = THREE.MathUtils.clamp(v.z, -D + 0.6, D - 0.6)
  return v
}

// Where the i-th die of a handful sits beside the first.
const spot = (i: number, into = new THREE.Vector3()) => into.set((i % 2) * 0.7 - 0.35, 0, Math.floor(i / 2) * 0.7)

const restOf = ({ frames, steps }: Track): Pose => {
  const o = (steps - 1) * 7
  return { position: new THREE.Vector3(frames[o], frames[o + 1], frames[o + 2]), rotation: new THREE.Quaternion(frames[o + 3], frames[o + 4], frames[o + 5], frames[o + 6]) }
}

export class DiceTray {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private fixtures: THREE.Mesh[] = []
  private placed: Placed[] = []
  private held: THREE.Mesh[] = []
  private playing: { meshes: THREE.Mesh[]; tracks: Track[]; turns: THREE.Quaternion[]; start: number; done: () => void } | null = null
  private flinging: ((f: Fling | null) => void) | null = null
  private hand = new THREE.Vector3(-W + 1.8, HAND, 0)
  private trail: { at: number; p: THREE.Vector3 }[] = []
  private ray = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private palm = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HAND)
  private scratch = new THREE.Vector3()
  private dirty = true
  private frame = 0
  private disposed = false
  private resizer: ResizeObserver

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.camera.position.set(0, 9.5, 5.2)
    this.camera.lookAt(0, 0, 0.3)
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#3a3020', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.8)
    sun.position.set(-3, 9, 4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, { left: -W, right: W, top: D + 1, bottom: -D - 1 })
    this.scene.add(sun)
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), new THREE.MeshStandardMaterial({ color: '#1f3b2c', roughness: 1 }))
    felt.rotation.x = -Math.PI / 2
    this.fixtures.push(felt)
    const rim = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.8 })
    for (const [w, d, x, z] of [[W * 2 + 0.4, 0.2, 0, -D - 0.1], [W * 2 + 0.4, 0.2, 0, D + 0.1], [0.2, D * 2, -W - 0.1, 0], [0.2, D * 2, W + 0.1, 0]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), rim)
      wall.position.set(x, 0.25, z)
      this.fixtures.push(wall)
    }
    for (const m of this.fixtures) {
      m.receiveShadow = true
      this.scene.add(m)
    }
    this.resizer = new ResizeObserver(() => this.resize())
    this.resizer.observe(canvas)
    this.resize()
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    this.frame = requestAnimationFrame(this.tick)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizer.disconnect()
    this.canvas.removeEventListener('pointerdown', this.down)
    this.canvas.removeEventListener('pointermove', this.move)
    this.canvas.removeEventListener('pointerup', this.up)
    this.clear()
    for (const m of this.fixtures) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  // Empties the tray.
  clear() {
    for (const m of [...this.placed.map((p) => p.mesh), ...this.held]) {
      this.scene.remove(m)
      for (const mat of m.material as THREE.Material[]) mat.dispose()
    }
    this.placed = []
    this.held = []
    this.dirty = true
  }

  // Fades every die at rest but those tagged `keep`.
  keepOnly(keep: number) {
    for (const p of this.placed) if (p.tag !== keep) for (const mat of p.mesh.material as THREE.Material[]) Object.assign(mat, { transparent: true, opacity: 0.35 })
    this.dirty = true
  }

  // The dice held over the tray until the hand flings them, or until
  // `release` throws them for it.
  hold(dice: TrayDie[]): Promise<Fling | null> {
    this.held = dice.map((d) => {
      const mesh = makeMesh(SHAPES[d.kind], LOOKS[d.kind])
      mesh.quaternion.copy(randomRotation())
      this.scene.add(mesh)
      return mesh
    })
    return new Promise((resolve) => { this.flinging = resolve })
  }

  release() {
    this.flinging?.(null)
    this.flinging = null
  }

  // Throws the dice, flung by hand or, without a fling, from the near wall,
  // and resolves once they are at rest showing their values.
  async throw(dice: TrayDie[], fling: Fling | null): Promise<void> {
    await init()
    if (this.disposed) return
    const world = new RAPIER.World({ x: 0, y: -32, z: 0 })
    world.createCollider(RAPIER.ColliderDesc.cuboid(W + 2, 0.5, D + 2).setTranslation(0, -0.5, 0).setFriction(0.7).setRestitution(0.25))
    for (const [hx, hz, x, z] of [[W + 1, 0.5, 0, -D - 0.5], [W + 1, 0.5, 0, D + 0.5], [0.5, D + 1, -W - 0.5, 0], [0.5, D + 1, W + 0.5, 0]]) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 4, hz).setTranslation(x, 3.5, z).setRestitution(0.45))
    }
    world.createCollider(RAPIER.ColliderDesc.cuboid(W + 1, 0.5, D + 1).setTranslation(0, 8, 0))
    for (const p of this.placed) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.position.x, p.position.y, p.position.z).setRotation(p.rotation))
      world.createCollider(RAPIER.ColliderDesc.convexHull(SHAPES[p.kind].hull)!, body)
    }
    const from = fling?.from ?? new THREE.Vector3(-W + 0.9, HAND, (Math.random() - 0.5) * D)
    const push = fling?.velocity ?? new THREE.Vector3(12 + Math.random() * 6, 1 + Math.random() * 2, (Math.random() - 0.5) * 8)
    const bodies = dice.map((d, i) => {
      const at = clampToTray(spot(i).add(from))
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 12)
      const v = push.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2))
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z).setRotation(this.held[i]?.quaternion ?? randomRotation())
        .setLinvel(v.x, v.y, v.z).setAngvel(spin).setCcdEnabled(true).setAngularDamping(0.25).setLinearDamping(0.1))
      world.createCollider(RAPIER.ColliderDesc.convexHull(SHAPES[d.kind].hull)!.setDensity(1.2).setFriction(0.55).setRestitution(0.35), body)
      return body
    })
    const tracks: Track[] = bodies.map(() => ({ frames: new Float32Array(MAX_STEPS * 7), steps: 0 }))
    for (let s = 0; s < MAX_STEPS; s++) {
      world.step()
      bodies.forEach((b, i) => {
        const t = b.translation()
        const r = b.rotation()
        const f = tracks[i].frames
        const o = s * 7
        f[o] = t.x; f[o + 1] = t.y; f[o + 2] = t.z
        f[o + 3] = r.x; f[o + 4] = r.y; f[o + 5] = r.z; f[o + 6] = r.w
        tracks[i].steps = s + 1
      })
      if (s > 30 && bodies.every((b) => b.isSleeping())) break
    }
    world.free()
    const rests = tracks.map(restOf)
    const turns = dice.map((d, i) => turnOnto(SHAPES[d.kind], d.value, faceUp(SHAPES[d.kind], rests[i].rotation)))
    for (const m of this.held) this.scene.remove(m)
    const meshes = dice.map((d, i) => this.held[i] ?? makeMesh(SHAPES[d.kind], LOOKS[d.kind]))
    this.held = []
    meshes.forEach((m) => this.scene.add(m))
    await new Promise<void>((done) => { this.playing = { meshes, tracks, turns, start: performance.now(), done } })
    dice.forEach((d, i) => this.placed.push({ ...rests[i], mesh: meshes[i], kind: d.kind, tag: d.tag }))
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1.4 ? 52 : 38
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // Draws only while something moves, or once after the tray changed.
  private tick = (now: number) => {
    if (this.disposed) return
    const p = this.playing
    if (p) {
      let finished = true
      p.meshes.forEach((m, i) => {
        const t = p.tracks[i]
        const s = Math.min(Math.floor(((now - p.start) / 1000) / STEP), t.steps - 1)
        if (s < t.steps - 1) finished = false
        const f = t.frames
        const o = s * 7
        m.position.set(f[o], f[o + 1], f[o + 2])
        m.quaternion.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]).multiply(p.turns[i])
      })
      if (finished) {
        this.playing = null
        p.done()
      }
    }
    this.held.forEach((m, i) => {
      m.position.copy(this.hand).add(spot(i, this.scratch))
      m.position.y += Math.sin(now / 300 + i) * 0.08
      m.rotateOnAxis(TWIRL, 0.03)
    })
    if (p || this.held.length > 0 || this.dirty) {
      this.renderer.render(this.scene, this.camera)
      this.dirty = false
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  private toTray(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect()
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    const hit = this.ray.ray.intersectPlane(this.palm, new THREE.Vector3())
    return hit && clampToTray(hit)
  }

  private down = (e: PointerEvent) => {
    if (!this.flinging) return
    const p = this.toTray(e)
    if (!p) return
    this.canvas.setPointerCapture(e.pointerId)
    this.hand.copy(p)
    this.trail = [{ at: e.timeStamp, p }]
  }

  private move = (e: PointerEvent) => {
    if (!this.flinging) return
    const p = this.toTray(e)
    if (!p) return
    this.hand.copy(p)
    if (this.trail.length === 0) return
    this.trail.push({ at: e.timeStamp, p })
    while (this.trail.length > 1 && e.timeStamp - this.trail[0].at >= 120) this.trail.shift()
  }

  private up = (e: PointerEvent) => {
    if (!this.flinging || this.trail.length === 0) return
    const first = this.trail[0]
    const dt = Math.max((e.timeStamp - first.at) / 1000, 1 / 60)
    const velocity = this.hand.clone().sub(first.p).divideScalar(dt)
    velocity.y = 0
    if (velocity.lengthSq() < 0.01) velocity.set(1, 0, 0)
    velocity.setLength(THREE.MathUtils.clamp(velocity.length(), MIN_SPEED, MAX_SPEED))
    velocity.y = 2
    this.trail = []
    const resolve = this.flinging
    this.flinging = null
    resolve({ from: this.hand.clone(), velocity })
  }
}
