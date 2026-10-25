import { z } from 'zod'
import { ActionSchema, BoardMapSchema, BoardSchema, CoordSchema, PlacementSchema, SceneStateSchema, TerrainCellSchema, type ActionKind, type ActionOf, type Board, type BoardMap, type SceneState } from './types'
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
  radius: z.unknown().optional(),
  ground: z.unknown().optional(),
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

// A kept board read the same way, whatever else is in it: the ground, with
// nobody on it and no layer an action left.
export function makeBoardMap(raw: unknown): BoardMap {
  const { placements: _placements, terrain, ...rest } = makeBoard(raw)
  const name = z.object({ name: z.string() }).safeParse(raw)
  return BoardMapSchema.parse({
    ...rest,
    name: name.success ? name.data.name : '',
    terrain: Object.fromEntries(Object.entries(terrain).map(([key, cell]) => [key, { ...cell, layers: [] }])),
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
  const radius = BoardSchema.shape.radius.safeParse(parsed.data.radius)
  const ground = BoardSchema.shape.ground.safeParse(parsed.data.ground)
  return BoardSchema.parse({
    placements: readEntries(parsed.data.placements, PlacementSchema, () => true),
    terrain: readEntries(parsed.data.terrain, TerrainCellSchema, (key) => parseCoordKey(key) !== null),
    ...(origin.success ? { origin: origin.data } : {}),
    ...(radius.success ? { radius: radius.data } : {}),
    ...(ground.success ? { ground: ground.data } : {}),
  })
}
