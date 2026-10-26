import { z } from 'zod'
import surfaceCatalog from '../../../../assets/surfaces.json'
import { SurfaceSchema, type Board, type Surface } from '../../types'

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
