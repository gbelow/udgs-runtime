import { BlurFilter, BufferImageSource, Container, Graphics, Matrix, Mesh, MeshGeometry, RenderTexture, Shader, Sprite, Texture, UniformGroup, type Renderer } from 'pixi.js'
import type { BoardCellView, BoardChordView, BoardLightView, BoardRidgeView } from '../domain/scene/projections/boardView'
import type { Point } from '../domain/scene/rules/board/geometry'

// The light and darkness of the board, as paths of light rather than whole
// hexes: a map of the plane the GPU draws once whenever the light changes. At
// every point it casts a ray to each source within reach, stopped by an
// opaque cell or an opaque thin wall it crosses, and lights the point where a
// ray gets through, fading at the edge of the source's radius. The rule's own
// word on each cell holds: only a cell a source lights is lit by the rays
// (and one the rule lights is lit whole when no ray of the plane reaches its
// middle, the rule seeing over what the plane cannot), and the cells' own
// darkness and what the one looking does not see are laid under it. The map
// is blurred so that the edges fall off softly, then made into the shade the
// board is drawn with: black for the dark, a warm tint where the light falls.

const MAX_SOURCES = 32
// how far a ray steps between looks at the cell under it, in board units
const RAY_STEP = 0.08
// pixels of the map to a board unit, and its largest side
const MAP_DENSITY = 12
const MAP_MOST = 2048
const MARGIN = 2
const BLUR = 0.35
const BLUR_PER_SIGMA = 2

const NIGHT_DIM = 0.6
const NIGHT_DARK = 0.85
const UNSEEN = 0.92
const GLOW = 0.2

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vPos;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
  vUV = aUV;
}
`

const LIGHT = `#version 300 es
in vec2 vPos;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uCells;
uniform vec2 uOrigin;
uniform vec2 uSize;
uniform vec2 uPlane;
uniform float uScale;
uniform vec3 uSources[${MAX_SOURCES}];
uniform float uCount;

const float SQ3 = 1.7320508;
const float STEP = ${RAY_STEP};

vec2 axial(vec2 p) { float q = p.x / 1.5; return vec2(q, p.y / SQ3 - q * 0.5); }
vec2 plane(vec2 h) { return vec2(1.5 * h.x, SQ3 * (h.y + h.x * 0.5)); }
vec2 hexRound(vec2 a) {
  vec3 c = vec3(a.x, a.y, -a.x - a.y);
  vec3 r = floor(c + 0.5);
  vec3 d = abs(r - c);
  if (d.x > d.y && d.x > d.z) r.x = -r.y - r.z;
  else if (d.y > d.z) r.y = -r.x - r.z;
  return r.xy;
}
vec4 cellAt(vec2 h) {
  vec2 t = h - uOrigin;
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uSize.x || t.y >= uSize.y) return vec4(0.0);
  return texture(uCells, (t + 0.5) / uSize);
}
int flagsOf(vec4 c) { return int(c.g * 255.0 + 0.5); }
vec2 corner(int i) { float a = 1.0471976 * float((i % 6 + 6) % 6); return vec2(cos(a), sin(a)); }
bool crosses(vec2 p, vec2 q, vec2 a, vec2 b) {
  vec2 r = q - p;
  vec2 s = b - a;
  float den = r.x * s.y - r.y * s.x;
  if (abs(den) < 1e-6) return false;
  vec2 ap = a - p;
  float t = (ap.x * s.y - ap.y * s.x) / den;
  float u = (ap.x * r.y - ap.y * r.x) / den;
  return t >= 0.0 && t <= 1.0 && u >= 0.0 && u <= 1.0;
}
// whether a ray from p gets to the source at s: no opaque cell between the
// two cells it joins, and no opaque thin wall of any cell it passes
bool reaches(vec2 p, vec2 s) {
  vec2 hp = hexRound(axial(p));
  vec2 hs = hexRound(axial(s));
  float len = distance(p, s);
  int n = max(1, int(ceil(len / STEP)));
  vec2 last = vec2(1e9);
  for (int k = 0; k <= n; k++) {
    vec2 h = hexRound(axial(mix(p, s, float(k) / float(n))));
    if (h == last) continue;
    last = h;
    vec4 c = cellAt(h);
    int flags = flagsOf(c);
    if ((flags & 8) != 0 && h != hp && h != hs) return false;
    int chords = int(c.b * 255.0 + 0.5);
    if (chords != 0) {
      vec2 centre = plane(h);
      for (int i = 0; i < 6; i++) {
        if ((chords & (1 << i)) != 0 && crosses(p, s, centre + corner(i - 1), centre + corner(i + 1))) return false;
      }
    }
  }
  return true;
}
float lightAt(vec2 p) {
  float best = 0.0;
  for (int i = 0; i < ${MAX_SOURCES}; i++) {
    if (float(i) >= uCount) break;
    vec3 s = uSources[i];
    float d = distance(p, s.xy);
    if (d > s.z) continue;
    float fall = 1.0 - smoothstep(s.z - 0.8, s.z, d);
    if (fall > best && reaches(p, s.xy)) best = fall;
  }
  return best;
}

void main() {
  vec2 p = uPlane + vPos / uScale;
  vec2 h = hexRound(axial(p));
  vec4 c = cellAt(h);
  int flags = flagsOf(c);
  if ((flags & 1) == 0) { finalColor = vec4(0.0); return; }
  bool lit = (flags & 2) != 0;
  bool unseen = (flags & 4) != 0;
  float dark = unseen ? ${UNSEEN} : c.r;
  float light = 0.0;
  if (!unseen && lit) {
    light = lightAt(p);
    if (light < 1.0 && lightAt(plane(h)) <= 0.0) light = 1.0;
  }
  finalColor = vec4(dark, light, lit && !unseen ? 1.0 : 0.0, 1.0);
}
`

const COMPOSE = `#version 300 es
in vec2 vPos;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uMap;
void main() {
  vec4 v = texture(uMap, vUV);
  if (v.a <= 0.001) { finalColor = vec4(0.0); return; }
  float dark = v.r / v.a;
  float light = clamp((v.g / v.a) * (v.b / v.a), 0.0, 1.0);
  float glow = ${GLOW} * light;
  float shade = dark * (1.0 - light);
  float alpha = glow + shade * (1.0 - glow);
  finalColor = vec4(vec3(1.0, 0.706, 0.353) * glow, alpha);
}
`

// The shade of the board, ready to be laid over its cells: the texture, and
// how its pixels lie over the plane.
export type ShadeMap = { texture: RenderTexture; plane: Point; scale: number; destroy: () => void }

const AMBIENT_DARK: Record<BoardCellView['ambient'], number> = { bright: 0, dim: NIGHT_DIM, dark: NIGHT_DARK }

// Where a cell lies in the plane, whatever it is drawn lifted to.
export function planeOf(c: Pick<BoardCellView, 'cell'>): Point {
  return { x: 1.5 * c.cell.q, y: Math.sqrt(3) * (c.cell.r + c.cell.q / 2) }
}

function cellsTexture(cells: BoardCellView[], chords: BoardChordView[]): { texture: Texture; origin: [number, number]; size: [number, number] } {
  const qs = cells.map((c) => c.cell.q)
  const rs = cells.map((c) => c.cell.r)
  const origin: [number, number] = [Math.min(...qs) - 1, Math.min(...rs) - 1]
  const size: [number, number] = [Math.max(...qs) - origin[0] + 2, Math.max(...rs) - origin[1] + 2]
  const data = new Uint8Array(size[0] * size[1] * 4)
  const at = (c: BoardCellView) => ((c.cell.r - origin[1]) * size[0] + (c.cell.q - origin[0])) * 4
  const byKey = new Map(cells.map((c) => [c.key, c]))
  for (const c of cells) {
    const i = at(c)
    data[i] = Math.round(AMBIENT_DARK[c.ambient] * 255)
    data[i + 1] = 1 | (c.lit ? 2 : 0) | (c.unseen ? 4 : 0) | (c.terrain === 'wall' ? 8 : 0)
    data[i + 3] = 255
  }
  for (const w of chords) {
    const c = byKey.get(w.cell)
    if (c && !w.glass) data[at(c) + 2] |= 1 << w.corner
  }
  const source = new BufferImageSource({ resource: data, width: size[0], height: size[1], format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' })
  return { texture: new Texture({ source }), origin, size }
}

function quad(width: number, height: number): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array([0, 0, width, 0, width, height, 0, height]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
}

// The board's shade drawn by `renderer`, from its cells, their thin walls and
// the sources of light; null for a board with no cells.
export function drawShadeMap(renderer: Renderer, cells: BoardCellView[], chords: BoardChordView[], lights: BoardLightView[]): ShadeMap | null {
  if (cells.length === 0) return null
  const points = cells.map(planeOf)
  const [x0, y0] = [Math.min(...points.map((p) => p.x)) - MARGIN, Math.min(...points.map((p) => p.y)) - MARGIN]
  const [x1, y1] = [Math.max(...points.map((p) => p.x)) + MARGIN, Math.max(...points.map((p) => p.y)) + MARGIN]
  const scale = Math.min(MAP_DENSITY, MAP_MOST / Math.max(x1 - x0, y1 - y0))
  const [width, height] = [Math.ceil((x1 - x0) * scale), Math.ceil((y1 - y0) * scale)]

  const grid = cellsTexture(cells, chords)
  const sources = new Float32Array(MAX_SOURCES * 3)
  const shining = lights.flatMap((l) => l.points.map((p) => ({ p, reach: Math.sqrt(3) * l.radius + 0.6 }))).slice(0, MAX_SOURCES)
  shining.forEach(({ p, reach }, i) => sources.set([p.x, p.y, reach], i * 3))
  const geometry = quad(width, height)
  const light = new Mesh({
    geometry,
    shader: Shader.from({
      gl: { vertex: VERTEX, fragment: LIGHT, name: 'board-light' },
      resources: {
        uCells: grid.texture.source,
        light: new UniformGroup({
          uOrigin: { value: new Float32Array(grid.origin), type: 'vec2<f32>' },
          uSize: { value: new Float32Array(grid.size), type: 'vec2<f32>' },
          uPlane: { value: new Float32Array([x0, y0]), type: 'vec2<f32>' },
          uScale: { value: scale, type: 'f32' },
          uSources: { value: sources, type: 'vec3<f32>', size: MAX_SOURCES },
          uCount: { value: shining.length, type: 'f32' },
        }),
      },
    }),
  })
  const raw = RenderTexture.create({ width, height })
  renderer.render({ container: light, target: raw, clear: true })

  const soft = RenderTexture.create({ width, height })
  const blurred = new Sprite(raw)
  const blur = new BlurFilter({ strength: BLUR * BLUR_PER_SIGMA * scale, quality: 4 })
  blurred.filters = [blur]
  const holder = new Container()
  holder.addChild(blurred)
  renderer.render({ container: holder, target: soft, clear: true })

  const shade = RenderTexture.create({ width, height })
  const compose = new Mesh({ geometry, shader: Shader.from({ gl: { vertex: VERTEX, fragment: COMPOSE, name: 'board-shade' }, resources: { uMap: soft.source } }) })
  renderer.render({ container: compose, target: shade, clear: true })

  light.shader?.destroy()
  compose.shader?.destroy()
  light.destroy()
  compose.destroy()
  holder.destroy({ children: true })
  blur.destroy()
  geometry.destroy()
  grid.texture.destroy(true)
  raw.destroy(true)
  soft.destroy(true)
  return { texture: shade, plane: { x: x0, y: y0 }, scale, destroy: () => shade.destroy(true) }
}

// The shade laid over cells, each where it is drawn, the shade read where it
// lies in the plane; and over the walls standing on them, the drops of their
// cliffs and their thin walls, each in the shade of the cell it stands on.
export function drawShadeOver(map: ShadeMap, cells: BoardCellView[], hex: Point[], walls: { ridges: BoardRidgeView[]; chords: BoardChordView[]; cellOf: (key: string) => BoardCellView | undefined }): Graphics {
  const g = new Graphics()
  const shaded = (c: BoardCellView) => {
    const plane = planeOf(c)
    return { texture: map.texture, matrix: new Matrix(1 / map.scale, 0, 0, 1 / map.scale, map.plane.x + c.x - plane.x, map.plane.y + c.y - plane.y), textureSpace: 'global' as const }
  }
  for (const c of cells) g.poly((c.hex ?? hex).flatMap((p) => [p.x + c.x, p.y + c.y])).fill(shaded(c))
  for (const r of walls.ridges) {
    const c = walls.cellOf(r.cell)
    if (c) for (const b of r.bands) if (b.face) g.poly(b.face.flatMap((p) => [p.x, p.y])).fill(shaded(c))
  }
  for (const w of walls.chords) {
    const c = walls.cellOf(w.cell)
    if (c && w.side) g.poly(w.side.flatMap((p) => [p.x, p.y])).fill(shaded(c))
  }
  return g
}
