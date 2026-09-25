import { z } from 'zod'
import type { CampaignCharacter } from '../types'
import { ActionSchema, BoardSchema, CoordSchema, PlacementSchema, TerrainCellSchema, type ActionKind, type ActionOf, type Board } from './types'
import { parseCoordKey } from './geometry'

// An action of a known kind, every field it does not name at its default.
export function makeAction<K extends ActionKind>(kind: K, fields: Partial<Omit<ActionOf<K>, 'kind'>> & { id: string; actorId: string }): ActionOf<K> {
  return ActionSchema.parse({ ...fields, kind }) as ActionOf<K>
}

// A board arrives from outside — a VTT snapshot, a saved fight — and is read
// the way a character is: best effort, entry by entry. A placement or a cell
// that cannot be read is dropped, and the rest of the board survives; a
// snapshot that is not an object at all is an empty board.

const BoardIngestSchema = z.object({
  placements: z.record(z.string(), z.unknown()).optional(),
  terrain: z.record(z.string(), z.unknown()).optional(),
  origin: z.unknown().optional(),
  radius: z.unknown().optional(),
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
  const origin = CoordSchema.safeParse(parsed.data.origin)
  const radius = BoardSchema.shape.radius.safeParse(parsed.data.radius)
  return BoardSchema.parse({
    placements: readEntries(parsed.data.placements, PlacementSchema, () => true),
    terrain: readEntries(parsed.data.terrain, TerrainCellSchema, (key) => parseCoordKey(key) !== null),
    ...(origin.success ? { origin: origin.data } : {}),
    ...(radius.success ? { radius: radius.data } : {}),
  })
}

// A fight holds instances, not characters: the same sheet can be added twice and
// the two copies take damage independently. `fightName` already disambiguates
// them for display, and the id does the same for storage — a copy whose id is
// already in the fight is issued a fresh one, so it cannot overwrite the entry
// that is keyed by it. The first copy keeps its id, which is what lets a player
// character loaded into combat still save back over its own record. The id
// source is injected to keep this deterministic.
export function addCharacterToCombat(
  char: CampaignCharacter,
  characters: Record<string, CampaignCharacter>,
  newId: () => string,
): CampaignCharacter {
  const fightName = makeFightName(char, characters)
  const id = characters[char.id] ? newId() : char.id
  return { ...char, id, fightName }
}

function makeFightName(char: CampaignCharacter, characters: Record<string, CampaignCharacter>): string {
  let newName = char.name
  let count = 1
  while (Object.values(characters).some((el) => el.fightName === newName)) {
    count++
    newName = char.name + count
  }
  return newName
}
