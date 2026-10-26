import type { Coord, GroundRecipe } from '../../types'
import { coordKey, toPlane } from './geometry'
import { getSurface } from './surface'

// What a recipe makes of a board's ground: for each cell the surface it lays
// and the roll that picks its picture. Each surface scores on each cell by its
// weight, a random term that scatters the cells (the whole of it at clump 0, so
// that the cells are a weighted draw each) and a smooth noise of its own that
// gathers them (the whole of it at clump 1, so that the surfaces lie in
// patches, wider the more they clump). The highest score wins the cell. The
// same recipe, cells and seed always make the same ground.

const NOISE_GAIN = 10
const PATCH_NEAR = 3
const PATCH_WIDE = 9

// murmur3's finalizer: a whole number scrambled into another.
function scramble(n: number): number {
  let h = n | 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

function hash(...parts: number[]): number {
  return parts.reduce((h, part) => scramble(h + Math.imul(part | 0, 0x9e3779b1)), 0x2545f491)
}

const unit = (h: number) => h / 4294967296

// Smooth noise in 0..1 on the plane, blended between random values on a unit
// lattice.
function noise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const ease = (t: number) => t * t * (3 - 2 * t)
  const fx = ease(x - x0)
  const fy = ease(y - y0)
  const at = (i: number, j: number) => unit(hash(seed, i, j))
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
}

export function planGround(recipe: GroundRecipe, cells: readonly Coord[], seed: number): Map<string, { surface: string; roll: number }> {
  const plan = new Map<string, { surface: string; roll: number }>()
  const entries = recipe.entries.filter((e) => e.weight > 0 && getSurface(e.surface))
  if (entries.length === 0) return plan
  const clump = Math.min(1, Math.max(0, recipe.clump))
  const patch = PATCH_NEAR + PATCH_WIDE * clump
  for (const cell of cells) {
    const { x, y } = toPlane(cell)
    let best = { surface: entries[0].surface, score: -Infinity }
    entries.forEach((e, i) => {
      const u = Math.min(1 - 1e-9, Math.max(1e-9, unit(hash(seed, cell.q, cell.r, i))))
      const scatter = -Math.log(-Math.log(u))
      const gather = noise(hash(seed, i), x / patch, y / patch) - 0.5
      const score = Math.log(e.weight) + (1 - clump) * scatter + clump * NOISE_GAIN * gather
      if (score > best.score) best = { surface: e.surface, score }
    })
    plan.set(coordKey(cell), { surface: best.surface, roll: hash(seed, cell.q, cell.r, 0x5bd1e995) >>> 1 })
  }
  return plan
}
