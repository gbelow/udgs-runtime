"use server"

import { Character } from './domain/types';
import { isBaseCharacter } from './domain/utils';
import redis from './redis'
import fs from "fs/promises";
import path from "path";


export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

// Every action returns a discriminated result instead of swallowing failures,
// so the client can surface them (see the sonner toasts in the callers).
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function loadJsonFromFolder(baseDir: string): Promise<JsonObject> {
  // Flat directory of <name>.json files — categorization lives inside each
  // file's `tags`, not in folder nesting, so there is nothing to recurse into.
  const result: JsonObject = {};

  const entries = await fs.readdir(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    // Remove .json extension; the bare name is the character's identity on disk.
    const key = path.basename(entry.name, ".json");
    const fullPath = path.join(baseDir, entry.name);
    const content = JSON.parse(await fs.readFile(fullPath, "utf-8")) as JsonValue;
    result[key] = content;
  }

  return result;
}



const BASE_CHARACTER_DIR = path.join(process.cwd(), "app/assets/characters");

// A base character's name *is* its filename, so it has to resolve to a single
// safe segment inside BASE_CHARACTER_DIR. A name that traverses is rejected
// rather than rewritten: the name stored inside the file and the name on disk
// have to stay the same string for the flat layout to keep its identity.
function resolveBaseCharacterFile(name: string): string | null {
  if (!name || name === "." || name === "..") return null;
  if (/[\/\0]/.test(name)) return null;
  if (name !== path.basename(name)) return null;

  const filePath = path.resolve(BASE_CHARACTER_DIR, `${name}.json`);
  return path.dirname(filePath) === BASE_CHARACTER_DIR ? filePath : null;
}

export async function getBasicCharList(): Promise<ActionResult<JsonObject>> {
  try {
    const characterData = await loadJsonFromFolder(BASE_CHARACTER_DIR);
    return { ok: true, data: characterData };
  } catch (err) {
    console.error('Error loading base character list:', err);
    return { ok: false, error: 'Failed to load base characters.' };
  }
}

export async function upsertBaseCharacter(data: Character): Promise<ActionResult> {
  if (!isBaseCharacter(data)) return { ok: false, error: 'Not a base character.' };
  if (!data.name.trim()) return { ok: false, error: 'Base characters need a name.' };

  // Base characters are dev-authored blueprints; their unique name *is* their
  // identity on disk, so the campaign uuid is intentionally dropped here.
  const { id, ...character } = data;
  void id;

  // Flat layout: <name>.json directly under app/assets/characters. There is
  // no folder path — categorization is carried by the `tags` field.
  const filePath = resolveBaseCharacterFile(character.name);
  if (!filePath) return { ok: false, error: 'Base character names must be a plain file name.' };

  try {
    await fs.mkdir(BASE_CHARACTER_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(character, null, 2), "utf-8");

    console.log(`✅ Created: ${filePath}`);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error writing base character:', err);
    return { ok: false, error: 'Failed to save base character.' };
  }
}

export async function deleteBaseCharacter(name: string): Promise<ActionResult> {
  const filePath = resolveBaseCharacterFile(name);
  if (!filePath) return { ok: false, error: 'Base character names must be a plain file name.' };

  try {
    await fs.unlink(filePath);
    console.log(`🗑️ Deleted: ${filePath}`);
    return { ok: true, data: undefined };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`⚠️ File not found: ${filePath}`);
      return { ok: false, error: 'Base character file not found.' };
    }
    console.error('Error deleting base character:', err);
    return { ok: false, error: 'Failed to delete base character.' };
  }
}


// The player-character index is a Redis hash of id -> name. Every write to it is
// a single atomic field op, so two saves arriving together cannot each write back
// a whole list they read before the other's entry existed.
const CHAR_INDEX_KEY = 'charIndex';
const LEGACY_CHAR_LIST_KEY = 'charList';

export async function saveCharacter(character: Character): Promise<ActionResult> {
  try {
    await redis.hset(CHAR_INDEX_KEY, { [character.id]: character.name });
    await redis.set(character.id, character);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error saving character to Redis:', err);
    return { ok: false, error: 'Failed to save character.' };
  }
}

export async function deleteCharacter(id: string): Promise<ActionResult> {
  try {
    await redis.hdel(CHAR_INDEX_KEY, id);
    await redis.del(id);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error deleting character from Redis:', err);
    return { ok: false, error: 'Failed to delete character.' };
  }
}

export async function getCharacter(id: string): Promise<ActionResult<Character | null>> {
  try {
    const character: Character | null = await redis.get(id);
    return { ok: true, data: character };
  } catch (err) {
    console.error('Error getting character from Redis:', err);
    return { ok: false, error: 'Failed to load character.' };
  }
}


export async function getCharacterList(): Promise<ActionResult<{id: string, name: string}[]>> {
  try {
    const index = await redis.hgetall<Record<string, string>>(CHAR_INDEX_KEY);
    if (index && Object.keys(index).length) {
      return { ok: true, data: Object.entries(index).map(([id, name]) => ({ id, name })) };
    }

    // Characters saved before the index was a hash are still in the array at the
    // old key; fold them in on first read and retire it.
    const legacy: {id: string, name: string}[] | null = await redis.get(LEGACY_CHAR_LIST_KEY);
    if (!legacy?.length) return { ok: true, data: [] };

    await redis.hset(CHAR_INDEX_KEY, Object.fromEntries(legacy.map(el => [el.id, el.name])));
    await redis.del(LEGACY_CHAR_LIST_KEY);
    return { ok: true, data: legacy };
  } catch (err) {
    console.error('Error getting character list from Redis:', err);
    return { ok: false, error: 'Failed to load character list.' };
  }
}
