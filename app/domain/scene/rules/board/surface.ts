import { z } from 'zod'
import surfaceCatalog from '../../../../assets/surfaces.json'
import { SurfaceSchema, type Board, type Surface, type SurfaceArt } from '../../types'

// The surfaces kept outside any board, by name.
const SURFACES: Record<string, Surface> = z.record(z.string(), SurfaceSchema).parse(surfaceCatalog)

export function getSurfaceNames(): string[] {
  return Object.keys(SURFACES)
}

export function getSurface(name: string): Surface | null {
  return SURFACES[name] ?? null
}

// What a cell is made of: its own surface, else the board's. A name gone from
// the catalog is no surface.
export function getCellSurface(board: Board, key: string): Surface | null {
  const name = board.terrain[key]?.surface ?? board.surface
  return name ? getSurface(name) : null
}

// The picture a laying draws: one of the surface's own by the roll when it
// randomizes, else its first; none for a surface with no pictures. A roll that
// is not a whole number draws the first.
export function pickArt(surface: Surface, roll: number): SurfaceArt | null {
  if (surface.arts.length === 0) return null
  return surface.arts[surface.randomize && Number.isInteger(roll) ? Math.abs(roll) % surface.arts.length : 0]
}

// A picture with how its surface meets the next one.
export type CellArt = SurfaceArt & { bleed: number; priority: number }

// The picture a cell is drawn with: the one it was laid with while its surface
// still lists it, else the surface's first. A cell that names no surface is
// the board's, drawn with that surface's first.
export function getCellArt(board: Board, key: string): CellArt | null {
  const surface = getCellSurface(board, key)
  if (!surface) return null
  const laid = board.terrain[key]?.surface ? board.terrain[key]?.art : null
  const art = surface.arts.find((a) => a.src === laid) ?? surface.arts[0]
  return art ? { ...art, bleed: surface.bleed, priority: surface.priority } : null
}
