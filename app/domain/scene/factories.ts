import { z } from 'zod'
import { ActionSchema, BoardExtentSchema, BoardMapSchema, BoardSchema, CoordSchema, LevelCellSchema, LevelSchema, PlacementSchema, SceneStateSchema, TerrainCellSchema, type ActionKind, type ActionOf, type Board, type BoardMap, type Level, type SceneState } from './types'
import { parseCoordKey } from './rules/board/geometry'

// An action of a known kind, every field it does not name at its default.
export function makeAction<K extends ActionKind>(kind: K, fields: Partial<Omit<ActionOf<K>, 'kind'>> & { id: string; actorId: string }): ActionOf<K> {
  return ActionSchema.parse({ ...fields, kind }) as ActionOf<K>
}

// A board arrives from outside — a kept map, a saved fight — and is read
// the way a character is: best effort, entry by entry. A placement or a cell
// that cannot be read is dropped, and the rest of the board survives; a
// snapshot that is not an object at all is an empty board.

const BoardIngestSchema = z.object({
  placements: z.record(z.string(), z.unknown()).optional(),
  terrain: z.record(z.string(), z.unknown()).optional(),
  origin: z.unknown().optional(),
  extent: z.unknown().optional(),
  radius: z.unknown().optional(),
  surface: z.unknown().optional(),
  levels: z.array(z.unknown()).optional(),
}).strip()

const LevelIngestSchema = z.object({
  floor: z.unknown().optional(),
  height: z.unknown().optional(),
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

// A storey that cannot be read is dropped with everything on it; one that can
// keeps the cells it can read, as the ground does.
function readLevels(raw: unknown[] | undefined): Level[] {
  const levels: Level[] = []
  for (const entry of raw ?? []) {
    const parsed = LevelIngestSchema.safeParse(entry)
    if (!parsed.success) continue
    const floor = LevelSchema.shape.floor.safeParse(parsed.data.floor)
    const height = LevelSchema.shape.height.safeParse(parsed.data.height)
    levels.push(LevelSchema.parse({
      ...(floor.success ? { floor: floor.data } : {}),
      ...(height.success ? { height: height.data } : {}),
      terrain: readEntries(parsed.data.terrain, LevelCellSchema, (key) => parseCoordKey(key) !== null),
    }))
  }
  return levels
}

// A kept board read the same way, whatever else is in it: the ground, with
// nobody on it and no layer an action left.
export function makeBoardMap(raw: unknown): BoardMap {
  const { placements: _placements, terrain, levels, ...rest } = makeBoard(raw)
  const clean = <T extends { layers: unknown[] }>(cells: Record<string, T>) => Object.fromEntries(Object.entries(cells).map(([key, cell]) => [key, { ...cell, layers: [] }]))
  const name = z.object({ name: z.string() }).safeParse(raw)
  return BoardMapSchema.parse({
    ...rest,
    name: name.success ? name.data.name : '',
    terrain: clean(terrain),
    levels: levels.map((level) => ({ ...level, terrain: clean(level.terrain) })),
  })
}

// A fight of nobody on the kept board, for what is asked of a fight's board.
export function sceneOfMap(map: BoardMap): SceneState {
  return SceneStateSchema.parse({ board: { ...map, placements: {} } })
}

export function makeBoard(raw: unknown): Board {
  const parsed = BoardIngestSchema.safeParse(raw)
  if (!parsed.success) return BoardSchema.parse({})
  const origin = CoordSchema.safeParse(parsed.data.origin)
  const extent = BoardSchema.shape.extent.safeParse(parsed.data.extent)
  const radius = BoardExtentSchema.shape.q.safeParse(parsed.data.radius)
  const surface = BoardSchema.shape.surface.safeParse(parsed.data.surface)
  return BoardSchema.parse({
    placements: readEntries(parsed.data.placements, PlacementSchema, () => true),
    terrain: readEntries(parsed.data.terrain, TerrainCellSchema, (key) => parseCoordKey(key) !== null),
    levels: readLevels(parsed.data.levels),
    ...(origin.success ? { origin: origin.data } : {}),
    ...(extent.success && parsed.data.extent !== undefined ? { extent: extent.data } : radius.success ? { extent: { q: radius.data, r: radius.data, s: radius.data } } : {}),
    ...(surface.success ? { surface: surface.data } : {}),
  })
}
