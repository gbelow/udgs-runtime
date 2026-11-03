import { BufferImageSource, Container, Mesh, MeshGeometry, Shader, Texture, UniformGroup } from 'pixi.js'
import type { BoardGround, BoardGroundCell } from '../domain/scene/projections/boardView'

// The ground at its own height, drawn by the GPU a picture at a time, lowest
// priority first, each over the whole board: at every point the shader finds
// the cell under it in a small texture of the board's cells (which picture
// each is laid with, how much of a neighbour's spreading it lets in), and
// shows the picture where the point lies within the picture's spreading of a
// hex laid with it, the edge roughened by noise. A hex that lets in only part
// of a spreading is reached by that part of it, one that lets in none by
// nothing, and the cut stays on the hex's own edge. The bank of a picture is a
// wet band just outside its edge, tinted over whatever lies there, with a pale
// lip; the pictures drawn after cover it.

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
}
`

const FRAGMENT = `#version 300 es
in vec2 vPos;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uCells;
uniform float uArt;
uniform float uBleed;
uniform float uRough;
uniform float uBank;
uniform float uTile;
uniform vec2 uOffset;
uniform vec2 uOrigin;
uniform vec2 uSize;

const float SQ3 = 1.7320508;
const float ROUGHNESS = 0.8;
const float FREQUENCY = 0.3;
const float FEATHER = 0.12;
const float BANK_TINT = 0.3;
const float BANK_SOFT = 0.3;
const float LIP = 0.3;
const float LIP_OPACITY = 0.5;

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
bool present(vec4 c) { return c.b > 0.5; }
bool laidWith(vec4 c) { return present(c) && abs(c.r * 255.0 - uArt) < 0.5; }
// the distance from a point to a flat-top hex of unit circumradius about the origin
float hexDistance(vec2 p) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  const float r = 0.866025404;
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// how far a point lies from the nearest hex laid with the picture, 0 inside one
float artDistance(vec2 p) {
  vec2 h = hexRound(axial(p));
  float best = 1000.0;
  vec2 around[7] = vec2[7](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));
  for (int i = 0; i < 7; i++) {
    vec2 n = h + around[i];
    if (laidWith(cellAt(n))) best = min(best, max(hexDistance(p - plane(n)), 0.0));
  }
  return best;
}

void main() {
  vec2 p = vPos;
  vec4 here = cellAt(hexRound(axial(p)));
  if (!present(here)) discard;
  bool own = laidWith(here);
  float lets = here.g;
  float cover;
  float edge;
  if (uBleed <= 0.0) {
    cover = own ? 1.0 : 0.0;
    edge = own ? -1.0 : artDistance(p);
  } else {
    vec2 shift = (vec2(noise(p * FREQUENCY), noise(p * FREQUENCY + vec2(17.3, 5.1))) - 0.5) * ROUGHNESS * uRough;
    float dist = artDistance(p + shift);
    float reach = own ? uBleed : uBleed * lets;
    cover = own || lets > 0.0 ? 1.0 - smoothstep(reach - FEATHER, reach + FEATHER, dist) : 0.0;
    edge = dist - reach;
  }
  float bank = 0.0;
  float lip = 0.0;
  if (uBank > 0.0 && !own && lets > 0.0) {
    bank = BANK_TINT * smoothstep(-FEATHER, FEATHER * 0.5, edge) * (1.0 - smoothstep(uBank * (1.0 - BANK_SOFT), uBank * (1.0 + BANK_SOFT), edge));
    lip = LIP_OPACITY * smoothstep(-0.02, 0.0, edge) * (1.0 - smoothstep(uBank * LIP - 0.02, uBank * LIP, edge));
  }
  vec4 color = texture(uTexture, (p - uOffset) / uTile) * cover;
  color = color * (1.0 - bank) + vec4(0.0, 0.0, 0.0, bank);
  color = color * (1.0 - lip) + vec4(lip);
  finalColor = color;
}
`

// The cells the shader reads: each drawn at its own place in the plane, at
// the ground's height, which seen from the front is only the ground no higher
// than the board's own. The rest are drawn crisp, in their bands.
export function isFlatGround(c: BoardGroundCell): boolean {
  return c.band === 0 && (c.base === null || Math.abs(c.base.y - c.y) < 1e-6)
}

function cellsTexture(cells: BoardGroundCell[]): { texture: Texture; origin: [number, number]; size: [number, number] } {
  const qs = cells.map((c) => c.cell.q)
  const rs = cells.map((c) => c.cell.r)
  const origin: [number, number] = [Math.min(...qs), Math.min(...rs)]
  const size: [number, number] = [Math.max(...qs) - origin[0] + 1, Math.max(...rs) - origin[1] + 1]
  const data = new Uint8Array(size[0] * size[1] * 4)
  for (const c of cells) {
    const at = ((c.cell.r - origin[1]) * size[0] + (c.cell.q - origin[0])) * 4
    data[at] = c.art === null ? 0 : c.art + 1
    data[at + 1] = Math.round(Math.max(0, Math.min(1, c.bledInto)) * 255)
    data[at + 2] = 255
    data[at + 3] = 255
  }
  const source = new BufferImageSource({ resource: data, width: size[0], height: size[1], format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' })
  return { texture: new Texture({ source }), origin, size }
}

const MARGIN = 2

// The ground of `ground` at its own height, a mesh to each picture laid on it
// whose picture has come; `texture` gives the picture of an art, null while it
// loads. The cells texture is its own and goes with the container.
export function drawFlatGround(ground: BoardGround, texture: (src: string) => Texture | null): Container {
  const out = new Container()
  const flat = [...ground.rims, ...ground.cells].filter(isFlatGround)
  if (flat.length === 0) return out
  const cells = cellsTexture(flat)
  const { x, y, width, height } = ground.frame
  const [x0, y0, x1, y1] = [x - MARGIN, y - MARGIN, x + width + MARGIN, y + height + MARGIN]
  const geometry = new MeshGeometry({
    positions: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const used = new Set(flat.map((c) => c.art))
  ground.arts.forEach((art, i) => {
    const picture = used.has(i) ? texture(art.src) : null
    if (!picture) return
    const uniforms = new UniformGroup({
      uArt: { value: i + 1, type: 'f32' },
      uBleed: { value: art.bleed, type: 'f32' },
      uRough: { value: art.roughness, type: 'f32' },
      uBank: { value: art.bank, type: 'f32' },
      uTile: { value: art.tile, type: 'f32' },
      uOffset: { value: new Float32Array([art.offsetX, art.offsetY]), type: 'vec2<f32>' },
      uOrigin: { value: new Float32Array(cells.origin), type: 'vec2<f32>' },
      uSize: { value: new Float32Array(cells.size), type: 'vec2<f32>' },
    })
    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT, name: 'board-ground' },
      resources: { uTexture: picture.source, uCells: cells.texture.source, ground: uniforms },
    })
    out.addChild(new Mesh({ geometry, shader }))
  })
  out.on('destroyed', () => cells.texture.destroy(true))
  return out
}
