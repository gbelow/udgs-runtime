import { z } from 'zod'
import surfaceCatalog from '../../../../assets/surfaces.json'
import { SurfaceSchema, type Board, type Surface, type SurfaceArt, type TerrainCell } from '../../types'

// The surfaces kept outside any board, by name.
const SURFACES: Record<string, Surface> = z.record(z.string(), SurfaceSchema).parse(surfaceCatalog)

export function getSurfaceNames(): string[] {
  return Object.keys(SURFACES)
}

export function getSurface(name: string): Surface | null {
  return SURFACES[name] ?? null
}

// Where a cell's surface is drawn from: its own where it names one; for the
// ground of a piece that names none and is no wall, the board's ground the
// piece covers there; else nothing, and the board's surface is drawn. Only the
// picture is taken: the values a surface lays are the cell's own.
function getSurfaceSource(board: Board, key: string): TerrainCell | null {
  const cell = board.terrain[key]
  if (cell?.surface) return cell
  const under = cell?.piece && !cell.blocking ? board.pieces[cell.piece]?.under[key] : undefined
  return under?.surface ? under : null
}

// The name of the surface a cell is drawn with, null for none.
export function getCellSurfaceName(board: Board, key: string): string | null {
  return getSurfaceSource(board, key)?.surface ?? board.surface
}

// What a cell is made of, as it is drawn (`getCellSurfaceName`). A name gone
// from the catalog is no surface.
export function getCellSurface(board: Board, key: string): Surface | null {
  const name = getCellSurfaceName(board, key)
  return name ? getSurface(name) : null
}

// The picture a laying draws: the one asked for by its path when the surface
// lists it, else one of the surface's own by the roll when it randomizes, else
// its first; none for a surface with no pictures. A roll that is not a whole
// number draws the first.
export function pickArt(surface: Surface, roll: number, frozen: string | null): SurfaceArt | null {
  if (surface.arts.length === 0) return null
  return surface.arts.find((a) => a.src === frozen) ?? surface.arts[surface.randomize && Number.isInteger(roll) ? Math.abs(roll) % surface.arts.length : 0]
}

// A surface and the pictures it may be laid with, by their paths.
export function getSurfaceChoices(): { name: string; arts: string[] }[] {
  return getSurfaceNames().map((name) => ({ name, arts: SURFACES[name].arts.map((a) => a.src) }))
}

// How much of a neighbour's spreading the ground of a cell lets in: all of it
// for ground with no surface.
export function getCellBledInto(board: Board, key: string): number {
  return getCellSurface(board, key)?.bledInto ?? 1
}

// A picture with how its surface meets the next one.
export type CellArt = SurfaceArt & { bleed: number; roughness: number; bank: number; priority: number }

// The picture a cell is drawn with: the one its surface was laid with while
// that surface still lists it, else the surface's first. A cell drawn with the
// board's surface is drawn with that surface's first.
export function getCellArt(board: Board, key: string): CellArt | null {
  const surface = getCellSurface(board, key)
  return surface ? withArt(surface, getSurfaceSource(board, key)?.art ?? null) : null
}

// The picture a storey's cell is drawn with: that of the surface laid on it,
// none where none was.
export function getFloorArt(cell: TerrainCell | undefined): CellArt | null {
  const surface = cell?.surface ? getSurface(cell.surface) : null
  return surface ? withArt(surface, cell?.art ?? null) : null
}

function withArt(surface: Surface, laid: string | null): CellArt | null {
  const art = surface.arts.find((a) => a.src === laid) ?? surface.arts[0]
  return art ? { ...art, bleed: surface.bleed, roughness: surface.roughness, bank: surface.bank, priority: surface.priority } : null
}
