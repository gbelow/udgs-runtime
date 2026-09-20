import { z } from 'zod'
import { BoardSchema, PlacementSchema, TerrainCellSchema, type Board } from './types'
import { parseCoordKey } from './geometry'

// A board arrives from outside — a VTT snapshot, a saved fight — and is read
// the way a character is: best effort, entry by entry. A placement or a cell
// that cannot be read is dropped, and the rest of the board survives; a
// snapshot that is not an object at all is an empty board.

const BoardIngestSchema = z.object({
  placements: z.record(z.string(), z.unknown()).optional(),
  terrain: z.record(z.string(), z.unknown()).optional(),
}).strip()

function readEntries<T>(record: Record<string, unknown> | undefined, schema: z.ZodType<T>, keepKey: (key: string) => boolean): Record<string, T> {
  if (!record) return {}
  const entries: [string, T][] = []
  for (const [key, raw] of Object.entries(record)) {
    if (!keepKey(key)) continue
    const parsed = schema.safeParse(raw)
    if (parsed.success) entries.push([key, parsed.data])
  }
  return Object.fromEntries(entries)
}

export function makeBoard(raw: unknown): Board {
  const parsed = BoardIngestSchema.safeParse(raw)
  if (!parsed.success) return BoardSchema.parse({})
  return BoardSchema.parse({
    placements: readEntries(parsed.data.placements, PlacementSchema, () => true),
    terrain: readEntries(parsed.data.terrain, TerrainCellSchema, (key) => parseCoordKey(key) !== null),
  })
}
