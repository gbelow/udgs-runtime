import * as THREE from 'three'

// The solids the tray throws: the d10 of play.tex ("Use the d10 that has 0 to
// 9 on it"), a pentagonal trapezohedron, and the d6 an explosion adds. Each
// face keeps the direction its label reads up along: toward its pole on the
// d10, so that the turn taking one face onto another is one of the solid's
// own turns and the solid itself is left where it was.

export type DieKind = 'd10' | 'd6'

export type Face = { corners: THREE.Vector3[]; normal: THREE.Vector3; centroid: THREE.Vector3; up: THREE.Vector3; value: number }
export type Shape = { kind: DieKind; hull: Float32Array; faces: Face[] }

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function face(given: THREE.Vector3[], value: number, toward: THREE.Vector3): Face {
  const centroid = given.reduce((a, c) => a.add(c), V(0, 0, 0)).divideScalar(given.length)
  const normal = V(0, 0, 0).subVectors(given[1], given[0]).cross(V(0, 0, 0).subVectors(given[2], given[0])).normalize()
  let corners = given
  if (normal.dot(centroid) < 0) {
    normal.negate()
    corners = [...given].reverse()
  }
  const raw = toward.clone().sub(centroid)
  const up = raw.sub(normal.clone().multiplyScalar(raw.dot(normal))).normalize()
  return { corners, normal, centroid, up, value }
}

const flat = (points: THREE.Vector3[]) => new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]))

// Opposite faces add up to 9, as on a die at the table.
export function makeD10(): Shape {
  const R = 0.55
  const h = 0.62
  const cos36 = Math.cos(Math.PI / 5)
  const z = (h * (1 - cos36)) / (1 + cos36)
  const top = V(0, h, 0)
  const bottom = V(0, -h, 0)
  const ring = (k: number, offset: number, y: number) => V(R * Math.cos((2 * Math.PI * k) / 5 + offset), y, R * Math.sin((2 * Math.PI * k) / 5 + offset))
  const U = [0, 1, 2, 3, 4].map((k) => ring(k, 0, z))
  const L = [0, 1, 2, 3, 4].map((k) => ring(k, Math.PI / 5, -z))
  const faces = [
    ...[0, 1, 2, 3, 4].map((k) => face([top, U[k], L[k], U[(k + 1) % 5]], 2 * k, top)),
    ...[0, 1, 2, 3, 4].map((j) => face([bottom, L[j], U[(j + 1) % 5], L[(j + 1) % 5]], 9 - 2 * ((j + 3) % 5), bottom)),
  ]
  return { kind: 'd10', hull: flat([top, bottom, ...U, ...L]), faces }
}

export function makeD6(): Shape {
  const a = 0.38
  const sides: [THREE.Vector3, THREE.Vector3, number][] = [
    [V(0, 1, 0), V(0, 0, 1), 1], [V(0, -1, 0), V(0, 0, 1), 6],
    [V(1, 0, 0), V(0, 1, 0), 2], [V(-1, 0, 0), V(0, 1, 0), 5],
    [V(0, 0, 1), V(0, 1, 0), 3], [V(0, 0, -1), V(0, 1, 0), 4],
  ]
  const faces = sides.map(([n, u, value]) => {
    const w = n.clone().cross(u)
    const c = n.clone().multiplyScalar(a)
    const at = (su: number, sw: number) => c.clone().add(u.clone().multiplyScalar(su * a)).add(w.clone().multiplyScalar(sw * a))
    return face([at(1, 1), at(1, -1), at(-1, -1), at(-1, 1)], value, c.clone().add(u))
  })
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => V(x * a, y * a, z * a))))
  return { kind: 'd6', hull: flat(corners), faces }
}

export const SHAPES: Record<DieKind, Shape> = { d10: makeD10(), d6: makeD6() }

const frame = (f: Face) => new THREE.Matrix4().makeBasis(f.up.clone().cross(f.normal), f.normal, f.up)

// The turn of the solid's own that takes the face showing `value` to where
// the face `landed` is: the die drawn turned by it shows `value` where the
// thrown one shows `landed`.
export function turnOnto(shape: Shape, value: number, landed: Face): THREE.Quaternion {
  const wanted = shape.faces.find((f) => f.value === value) ?? landed
  const m = frame(landed).multiply(frame(wanted).transpose())
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

// The face a die at rest at `rotation` shows up.
export function faceUp(shape: Shape, rotation: THREE.Quaternion): Face {
  const height = (f: Face) => f.normal.clone().applyQuaternion(rotation).y
  return shape.faces.reduce((best, f) => (height(f) > height(best) ? f : best))
}

export type Look = { body: string; ink: string }

function label(kind: DieKind, value: number, look: Look): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = look.body
  g.fillRect(0, 0, size, size)
  g.fillStyle = look.ink
  if (kind === 'd6') {
    const pips: Record<number, [number, number][]> = {
      1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
    }
    for (const [x, y] of pips[value]) {
      g.beginPath()
      g.arc(size / 2 + x * 30, size / 2 + y * 30, 11, 0, Math.PI * 2)
      g.fill()
    }
  } else {
    g.font = 'bold 44px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(value), size / 2, size / 2 + 6)
    if (value === 6 || value === 9) g.fillRect(size / 2 - 12, size / 2 + 30, 24, 4)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// What every die of a kind draws with, made once: the solid, and each face's
// label upright along the face's up.
type Drawn = { geometry: THREE.BufferGeometry; labels: THREE.CanvasTexture[] }
const drawn = new Map<DieKind, Drawn>()

function draw(shape: Shape, look: Look): Drawn {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const geometry = new THREE.BufferGeometry()
  shape.faces.forEach((f, i) => {
    const right = f.up.clone().cross(f.normal)
    const extent = Math.max(...f.corners.map((p) => Math.max(Math.abs(p.clone().sub(f.centroid).dot(right)), Math.abs(p.clone().sub(f.centroid).dot(f.up)))))
    const span = extent * 2.05
    const start = positions.length / 3
    for (let k = 1; k + 1 < f.corners.length; k++) {
      for (const p of [f.corners[0], f.corners[k], f.corners[k + 1]]) {
        positions.push(p.x, p.y, p.z)
        normals.push(f.normal.x, f.normal.y, f.normal.z)
        const d = p.clone().sub(f.centroid)
        uvs.push(0.5 + d.dot(right) / span, 0.5 + d.dot(f.up) / span)
      }
    }
    geometry.addGroup(start, positions.length / 3 - start, i)
  })
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return { geometry, labels: shape.faces.map((f) => label(shape.kind, f.value, look)) }
}

// A die drawn with materials of its own, so it can be faded alone; the solid
// and the labels are shared by every die of its kind.
export function makeMesh(shape: Shape, look: Look): THREE.Mesh {
  if (!drawn.has(shape.kind)) drawn.set(shape.kind, draw(shape, look))
  const { geometry, labels } = drawn.get(shape.kind)!
  const mesh = new THREE.Mesh(geometry, labels.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.05 })))
  mesh.castShadow = true
  return mesh
}
