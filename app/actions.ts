"use server"

import { Character, Race } from './domain/types';
import { makeRace } from './domain/factories';
import { CollectionSchema, CrawlMapSchema, type Collection, type CrawlMap } from './domain/campaign/types';
import { SavedBoardMapSchema, type BoardMap, type SavedBoardMap } from './domain/scene/types';
import { makeBoardMap } from './domain/scene/factories';
import { CampaignSaveSchema, getCampaignSaveBar, getDeleteBar, getLockBar, getOverwriteBar, type CampaignSave } from './domain/saves';
import { canReadCollection, isOwnerOrDev, CampaignListingSchema, CharacterListingSchema, getAssignBar, getCampaignRole, getCampaignRow, getJoinBar, type CampaignRow, getOwnersSeenBy, getProfileNameBar, hasGmTools, ProfileSchema, type CampaignListing, type DicePlace, type CampaignMembers, type CharacterListing, type Profile, type ProfileListing } from './domain/profiles';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { ZodType } from 'zod';
import { isDevServer } from './devServer';
import type { CampaignCharacter } from './domain/types';
import { CATALOGS, isCatalogName } from './forms/catalogs';
import { isBaseCharacter, without } from './domain/utils';
import redis from './redis'
import { readMailbox, writeMailbox } from './vtt/mailbox'
import type { BoardSnapshot } from './vtt/snapshot'
import fs from "fs/promises";
import path from "path";


export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

const DEV_ONLY = { ok: false, error: 'Base content is saved only on the dev server.' } as const;

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
  return resolveNamedFile(BASE_CHARACTER_DIR, name);
}

function resolveNamedFile(dir: string, name: string): string | null {
  if (!name || name === "." || name === "..") return null;
  if (/[\/\0]/.test(name)) return null;
  if (name !== path.basename(name)) return null;

  const filePath = path.resolve(dir, `${name}.json`);
  return path.dirname(filePath) === dir ? filePath : null;
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
  if (!isDevServer()) return DEV_ONLY;
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
  if (!isDevServer()) return DEV_ONLY;
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


// Races are dev-authored presets, laid out like base characters: <name>.json
// directly under app/assets/races, the name being the identity on disk.
const RACE_DIR = path.join(process.cwd(), "app/assets/races");

export async function getRaceList(): Promise<ActionResult<JsonObject>> {
  try {
    await fs.mkdir(RACE_DIR, { recursive: true });
    return { ok: true, data: await loadJsonFromFolder(RACE_DIR) };
  } catch (err) {
    console.error('Error loading races:', err);
    return { ok: false, error: 'Failed to load races.' };
  }
}

export async function upsertRace(data: Race): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  const race = makeRace(data);
  if (!race.name.trim()) return { ok: false, error: 'Races need a name.' };
  const filePath = resolveNamedFile(RACE_DIR, race.name);
  if (!filePath) return { ok: false, error: 'Race names must be a plain file name.' };

  try {
    await fs.mkdir(RACE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(race, null, 2) + "\n", "utf-8");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error writing race:', err);
    return { ok: false, error: 'Failed to save race.' };
  }
}

export async function deleteRace(name: string): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  const filePath = resolveNamedFile(RACE_DIR, name);
  if (!filePath) return { ok: false, error: 'Race names must be a plain file name.' };

  try {
    await fs.unlink(filePath);
    return { ok: true, data: undefined };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'Race file not found.' };
    console.error('Error deleting race:', err);
    return { ok: false, error: 'Failed to delete race.' };
  }
}

// Point crawl maps are authored like races: <name>.json directly under
// app/assets/maps, the name being the identity on disk.
const MAP_DIR = path.join(process.cwd(), "app/assets/maps");

export async function getMapList(): Promise<ActionResult<JsonObject>> {
  try {
    await fs.mkdir(MAP_DIR, { recursive: true });
    return { ok: true, data: await loadJsonFromFolder(MAP_DIR) };
  } catch (err) {
    console.error('Error loading maps:', err);
    return { ok: false, error: 'Failed to load maps.' };
  }
}

export async function upsertMap(data: CrawlMap): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  const parsed = CrawlMapSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: 'Not a map.' };
  const map = parsed.data;
  if (!map.name.trim()) return { ok: false, error: 'Maps need a name.' };
  const filePath = resolveNamedFile(MAP_DIR, map.name);
  if (!filePath) return { ok: false, error: 'Map names must be a plain file name.' };

  try {
    await fs.mkdir(MAP_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(map, null, 2) + "\n", "utf-8");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error writing map:', err);
    return { ok: false, error: 'Failed to save map.' };
  }
}

export async function deleteMap(name: string): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  const filePath = resolveNamedFile(MAP_DIR, name);
  if (!filePath) return { ok: false, error: 'Map names must be a plain file name.' };

  try {
    await fs.unlink(filePath);
    return { ok: true, data: undefined };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'Map file not found.' };
    console.error('Error deleting map:', err);
    return { ok: false, error: 'Failed to delete map.' };
  }
}

// ── kept battle maps ────────────────────────────────────────────────────
// The developer's are <name>.json under app/assets/boards, shared with
// everyone; a profile's own are fields of one Redis hash, id -> the map and
// its owner, seen by that profile alone.
const BOARD_DIR = path.join(process.cwd(), "app/assets/boards");
const BOARDS_KEY = 'boardMaps';
const SHARED_PREFIX = 'shared:';

export async function getBoardMapList(): Promise<ActionResult<Record<string, SavedBoardMap>>> {
  try {
    await fs.mkdir(BOARD_DIR, { recursive: true });
    const files = await loadJsonFromFolder(BOARD_DIR);
    const shared = Object.fromEntries(Object.entries(files).map(([name, raw]) => [SHARED_PREFIX + name, { id: SHARED_PREFIX + name, owner: null, map: makeBoardMap({ ...(raw as object), name }) }]));
    const profile = await getProfileId();
    const own = profile ? Object.fromEntries(Object.entries(await readIndex(BOARDS_KEY, SavedBoardMapSchema)).filter(([, b]) => b.owner === profile)) : {};
    return { ok: true, data: { ...shared, ...own } };
  } catch (err) {
    console.error('Error loading battle maps:', err);
    return { ok: false, error: 'Failed to load battle maps.' };
  }
}

// Keeps the map under its name: as a file for everyone on the dev server, or
// as the profile's own.
export async function saveBoardMap(raw: BoardMap, shared: boolean): Promise<ActionResult> {
  const map = makeBoardMap(raw);
  if (!map.name.trim()) return { ok: false, error: 'Battle maps need a name.' };
  try {
    if (shared) {
      if (!isDevServer()) return DEV_ONLY;
      const filePath = resolveNamedFile(BOARD_DIR, map.name);
      if (!filePath) return { ok: false, error: 'Battle map names must be a plain file name.' };
      await fs.mkdir(BOARD_DIR, { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(map, null, 2) + "\n", "utf-8");
      return { ok: true, data: undefined };
    }
    const profile = await getProfileId();
    if (!profile) return { ok: false, error: 'Pick a profile first.' };
    const own = Object.values(await readIndex(BOARDS_KEY, SavedBoardMapSchema)).find((b) => b.owner === profile && b.map.name === map.name);
    const id = own?.id ?? crypto.randomUUID();
    await redis.hset(BOARDS_KEY, { [id]: { id, owner: profile, map } });
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error saving battle map:', err);
    return { ok: false, error: 'Failed to save battle map.' };
  }
}

export async function deleteBoardMap(id: string): Promise<ActionResult> {
  try {
    if (id.startsWith(SHARED_PREFIX)) {
      if (!isDevServer()) return DEV_ONLY;
      const filePath = resolveNamedFile(BOARD_DIR, id.slice(SHARED_PREFIX.length));
      if (!filePath) return { ok: false, error: 'Battle map names must be a plain file name.' };
      await fs.unlink(filePath);
      return { ok: true, data: undefined };
    }
    const { profile, dev } = await getViewer();
    const before = SavedBoardMapSchema.safeParse(await redis.hget(BOARDS_KEY, id));
    if (!before.success) return { ok: false, error: 'Battle map not found.' };
    if (!isOwnerOrDev(before.data.owner, profile, dev)) return { ok: false, error: 'Only its owner deletes this battle map.' };
    await redis.hdel(BOARDS_KEY, id);
    return { ok: true, data: undefined };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: 'Battle map not found.' };
    console.error('Error deleting battle map:', err);
    return { ok: false, error: 'Failed to delete battle map.' };
  }
}

// The player-character index is a Redis hash of id -> the character's row: its
// name and the profile that owns it. Every write to it is a single atomic field
// op, so two saves arriving together cannot each write back a whole list they
// read before the other's entry existed.
const CHAR_INDEX_KEY = 'charIndex';

// Every row of the index hash under `key` that `schema` reads, by id; a row
// it cannot read is left out.
async function readIndex<T>(key: string, schema: ZodType<T>): Promise<Record<string, T>> {
  const index = (await redis.hgetall<Record<string, unknown>>(key)) ?? {};
  return Object.fromEntries(Object.entries(index).flatMap(([id, row]) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? [[id, parsed.data]] : [];
  }));
}

const readCharIndex = () => readIndex(CHAR_INDEX_KEY, CharacterListingSchema);

async function readCharRow(id: string): Promise<CharacterListing> {
  return CharacterListingSchema.parse(await redis.hget(CHAR_INDEX_KEY, id));
}

// Whose player characters the profile at the screen sees: their own, and
// those of everyone in a campaign they are the GM of.
async function getSeenOwners(profile: string): Promise<Set<string>> {
  return getOwnersSeenBy(profile, Object.values(await readCampaignIndex()).map((c) => c.members));
}

// A character keeps the owner it was first saved by, and only they change
// it; one saved for the first time belongs to the profile saving it.
export async function saveCharacter(character: Character): Promise<ActionResult> {
  try {
    const [{ profile, dev }, { owner: before }] = await Promise.all([getViewer(), readCharRow(character.id)]);
    if (before && !isOwnerOrDev(before, profile, dev)) return { ok: false, error: 'Only its owner saves this character.' };
    const owner = before ?? profile;
    if (!owner) return { ok: false, error: 'Pick a profile first.' };
    const writes = redis.pipeline();
    writes.hset(CHAR_INDEX_KEY, { [character.id]: { name: character.name, owner } });
    writes.set(character.id, character);
    await writes.exec();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error saving character to Redis:', err);
    return { ok: false, error: 'Failed to save character.' };
  }
}

export async function deleteCharacter(id: string): Promise<ActionResult> {
  try {
    const [{ profile, dev }, { owner }] = await Promise.all([getViewer(), readCharRow(id)]);
    if (!isOwnerOrDev(owner, profile, dev)) return { ok: false, error: 'Only its owner deletes this character.' };
    const writes = redis.pipeline();
    writes.hdel(CHAR_INDEX_KEY, id);
    writes.del(id);
    await writes.exec();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error deleting character from Redis:', err);
    return { ok: false, error: 'Failed to delete character.' };
  }
}

export async function getCharacter(id: string): Promise<ActionResult<Character | null>> {
  try {
    const [{ profile, dev }, { owner }, character] = await Promise.all([getViewer(), readCharRow(id), redis.get<Character>(id)]);
    if (!dev && !(profile && owner && (await getSeenOwners(profile)).has(owner))) return { ok: false, error: 'Not a character you can open.' };
    return { ok: true, data: character };
  } catch (err) {
    console.error('Error getting character from Redis:', err);
    return { ok: false, error: 'Failed to load character.' };
  }
}


// The player characters the profile picked at the screen sees: their own,
// and those of everyone in a campaign they are the GM of.
export async function getCharacterList(): Promise<ActionResult<{id: string, name: string, owner: string}[]>> {
  try {
    const profile = await getProfileId();
    if (!profile) return { ok: true, data: [] };
    const [index, seen] = await Promise.all([readCharIndex(), getSeenOwners(profile)]);
    return { ok: true, data: Object.entries(index).flatMap(([id, row]) => row.owner !== null && seen.has(row.owner) ? [{ id, name: row.name, owner: row.owner }] : []) };
  } catch (err) {
    console.error('Error getting character list from Redis:', err);
    return { ok: false, error: 'Failed to load character list.' };
  }
}


// ── profiles ────────────────────────────────────────────────────────────
// A profile is one Redis document, indexed in a hash of id -> name. The one
// picked at a screen is kept in a cookie, so every action can read who is
// asking.
const PROFILE_INDEX_KEY = 'profileIndex';
const PROFILE_COOKIE = 'profile';
const profileKey = (id: string) => `profile:${id}`;

async function readProfile(id: string): Promise<Profile | null> {
  const parsed = ProfileSchema.safeParse(await redis.get(profileKey(id)));
  return parsed.success ? parsed.data : null;
}

async function getProfileId(): Promise<string | null> {
  return (await cookies()).get(PROFILE_COOKIE)?.value ?? null;
}

// Who is asking: the profile picked at the screen, and whether this is the
// dev server, where they are the developer.
async function getViewer(): Promise<{ profile: string | null; dev: boolean }> {
  return { profile: await getProfileId(), dev: isDevServer() };
}

async function setProfileCookie(id: string): Promise<void> {
  (await cookies()).set(PROFILE_COOKIE, id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
}

export async function getProfileList(): Promise<ActionResult<ProfileListing[]>> {
  try {
    const index = (await redis.hgetall<Record<string, string>>(PROFILE_INDEX_KEY)) ?? {};
    return { ok: true, data: Object.entries(index).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    console.error('Error listing profiles:', err);
    return { ok: false, error: 'Failed to list profiles.' };
  }
}

// The profile this screen picked, or null when it has picked none or the one
// it picked is gone.
export async function getCurrentProfile(): Promise<ActionResult<Profile | null>> {
  try {
    const id = await getProfileId();
    return { ok: true, data: id ? await readProfile(id) : null };
  } catch (err) {
    console.error('Error reading the current profile:', err);
    return { ok: false, error: 'Failed to read the current profile.' };
  }
}

export async function pickProfile(id: string): Promise<ActionResult<Profile>> {
  try {
    const profile = await readProfile(id);
    if (!profile) return { ok: false, error: 'Profile not found.' };
    await setProfileCookie(id);
    return { ok: true, data: profile };
  } catch (err) {
    console.error('Error picking profile:', err);
    return { ok: false, error: 'Failed to pick profile.' };
  }
}

// A new profile, picked at once.
export async function createProfile(name: string): Promise<ActionResult<Profile>> {
  const bar = getProfileNameBar(name);
  if (bar) return { ok: false, error: bar };
  try {
    const profile = ProfileSchema.parse({ id: crypto.randomUUID(), name: name.trim() });
    const writes = redis.pipeline();
    writes.set(profileKey(profile.id), profile);
    writes.hset(PROFILE_INDEX_KEY, { [profile.id]: profile.name });
    await writes.exec();
    await setProfileCookie(profile.id);
    return { ok: true, data: profile };
  } catch (err) {
    console.error('Error creating profile:', err);
    return { ok: false, error: 'Failed to create profile.' };
  }
}

export async function renameProfile(id: string, name: string): Promise<ActionResult<Profile>> {
  const bar = getProfileNameBar(name);
  if (bar) return { ok: false, error: bar };
  try {
    const viewer = await getViewer();
    if (!viewer.dev && viewer.profile !== id) return { ok: false, error: 'Only its owner renames a profile.' };
    const before = await readProfile(id);
    if (!before) return { ok: false, error: 'Profile not found.' };
    const profile = { ...before, name: name.trim() };
    const writes = redis.pipeline();
    writes.set(profileKey(id), profile);
    writes.hset(PROFILE_INDEX_KEY, { [id]: profile.name });
    await writes.exec();
    return { ok: true, data: profile };
  } catch (err) {
    console.error('Error renaming profile:', err);
    return { ok: false, error: 'Failed to rename profile.' };
  }
}

// Where the profile at the screen rolls its dice.
export async function setDicePlace(dice: DicePlace): Promise<ActionResult<Profile>> {
  try {
    const id = await getProfileId();
    const before = id ? await readProfile(id) : null;
    if (!id || !before) return { ok: false, error: 'Pick a profile first.' };
    const profile = { ...before, dice };
    await redis.set(profileKey(id), profile);
    return { ok: true, data: profile };
  } catch (err) {
    console.error('Error setting dice:', err);
    return { ok: false, error: 'Failed to set where you roll.' };
  }
}


// ── campaigns ───────────────────────────────────────────────────────────
// A campaign is one Redis document naming its characters by id, indexed in a
// hash of id -> its name and who plays it, like the player characters. Every
// character in a campaign is the campaign's alone, a copy kept under a key of
// the campaign's, so the same character played in two campaigns is two records.
const CAMPAIGN_INDEX_KEY = 'campaignIndex';
const campaignKey = (id: string) => `campaign:${id}`;
const campaignCharacterKey = (id: string, characterId: string) => `campaign:${id}:char:${characterId}`;

// Read once per request: the page's lists all need it.
const readCampaignIndex = cache((): Promise<Record<string, CampaignListing>> => readIndex(CAMPAIGN_INDEX_KEY, CampaignListingSchema));

async function readCampaign(id: string): Promise<CampaignSave | null> {
  const parsed = CampaignSaveSchema.safeParse(await redis.get(campaignKey(id)));
  return parsed.success ? parsed.data : null;
}

// Every saved campaign, as the profile picked at the screen sees it: what
// they are in it, and the requests to join it they may see.
export async function getCampaignList(): Promise<ActionResult<CampaignRow[]>> {
  try {
    const [index, pcs, profile] = await Promise.all([readCampaignIndex(), readCharIndex(), getProfileId()]);
    const rows = Object.entries(index).map(([id, r]) => getCampaignRow(id, r, profile, (cid) => pcs[cid]?.name ?? ''));
    return { ok: true, data: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    console.error('Error listing campaigns:', err);
    return { ok: false, error: 'Failed to list campaigns.' };
  }
}

async function readCampaignRow(id: string): Promise<CampaignListing | null> {
  const raw = await redis.hget(CAMPAIGN_INDEX_KEY, id);
  return raw ? CampaignListingSchema.parse(raw) : null;
}

// A profile asks to bring one of their characters into a saved campaign.
export async function requestToJoin(campaign: string, character: string): Promise<ActionResult> {
  try {
    const [row, { owner }, profile] = await Promise.all([readCampaignRow(campaign), readCharRow(character), getProfileId()]);
    if (!row) return { ok: false, error: 'Campaign not found.' };
    const bar = getJoinBar(row, character, owner, profile);
    if (bar || !profile) return { ok: false, error: `Not asked: ${bar}.` };
    await redis.hset(CAMPAIGN_INDEX_KEY, { [campaign]: { ...row, requests: { ...row.requests, [character]: profile } } });
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error asking to join a campaign:', err);
    return { ok: false, error: 'Failed to ask to join.' };
  }
}

// The profile that asked takes a request back.
export async function withdrawRequest(campaign: string, character: string): Promise<ActionResult> {
  try {
    const [row, profile] = await Promise.all([readCampaignRow(campaign), getProfileId()]);
    if (!row || row.requests[character] !== profile) return { ok: false, error: 'Not a request of yours.' };
    await redis.hset(CAMPAIGN_INDEX_KEY, { [campaign]: { ...row, requests: without(row.requests, character) } });
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error withdrawing a request:', err);
    return { ok: false, error: 'Failed to withdraw the request.' };
  }
}

// The GM answers a request. Accepted, the profile asking plays the campaign
// from then on, and the character comes back to be put on its roster, theirs.
export async function answerRequest(campaign: string, character: string, accept: boolean): Promise<ActionResult<{ members: CampaignMembers, character: Character | null, owner: string } | null>> {
  try {
    const [row, save, { profile, dev }] = await Promise.all([readCampaignRow(campaign), readCampaign(campaign), getViewer()]);
    if (!row || !save) return { ok: false, error: 'Campaign not found.' };
    if (!hasGmTools(getCampaignRole(save.members, profile, dev))) return { ok: false, error: 'Only a GM answers a request.' };
    const by = row.requests[character];
    if (!by) return { ok: false, error: 'No such request.' };
    const requests = without(row.requests, character);
    if (!accept) {
      await redis.hset(CAMPAIGN_INDEX_KEY, { [campaign]: { ...row, requests } });
      return { ok: true, data: null };
    }
    const members: CampaignMembers = by in save.members ? save.members : { ...save.members, [by]: 'player' };
    const writes = redis.pipeline();
    writes.set(campaignKey(campaign), { ...save, members });
    writes.hset(CAMPAIGN_INDEX_KEY, { [campaign]: { ...row, members, requests } });
    await writes.exec();
    return { ok: true, data: { members, character: await redis.get<Character>(character), owner: by } };
  } catch (err) {
    console.error('Error answering a request:', err);
    return { ok: false, error: 'Failed to answer the request.' };
  }
}

// Only a GM saves a campaign. One nobody has joined yet is saved as the GM's
// of whoever saves it; the members it was saved with come back.
// A character the GM gave a player is played by them from then on, as the
// save records; one taken back is played by nobody.
// A locked campaign is never saved over; play on it is saved as a copy.
export async function saveCampaign(raw: CampaignSave, characters: CampaignCharacter[]): Promise<ActionResult<SavedCampaign>> {
  return writeCampaign(raw, characters, false);
}

// Saves the campaign and locks it, so that it is played from as it stands
// now; one with a fight being played out is refused.
export async function lockCampaign(raw: CampaignSave, characters: CampaignCharacter[]): Promise<ActionResult<SavedCampaign>> {
  return writeCampaign(raw, characters, true);
}

type SavedCampaign = { members: CampaignMembers, savedAt: number };

async function writeCampaign(raw: CampaignSave, characters: CampaignCharacter[], locked: boolean): Promise<ActionResult<SavedCampaign>> {
  const verb = locked ? 'lock' : 'save';
  const parsed = CampaignSaveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Not a campaign.' };
  const bar = locked ? getLockBar(parsed.data.name, parsed.data.fight) : getCampaignSaveBar(parsed.data.name);
  if (bar) return { ok: false, error: `Not saved: ${bar}.` };
  try {
    const { profile, dev } = await getViewer();
    if (!profile) return { ok: false, error: 'Pick a profile first.' };
    const members = Object.keys(parsed.data.members).length ? parsed.data.members : { [profile]: 'gm' as const };
    const save: CampaignSave = { ...parsed.data, members, locked, savedAt: Date.now() };
    const [before, row] = await Promise.all([readCampaign(save.id), readCampaignRow(save.id)]);
    if (before && !hasGmTools(getCampaignRole(before.members, profile, dev))) return { ok: false, error: `Only a GM can ${verb} the campaign.` };
    const overwriteBar = getOverwriteBar(before?.locked ?? false);
    if (overwriteBar) return { ok: false, error: `Not saved: ${overwriteBar}.` };
    const assigned = Object.entries(save.owners).filter(([cid, owner]) => owner !== (before?.owners[cid] ?? null));
    const assignBar = assigned.map(([, owner]) => getAssignBar(save.members, owner)).find((bar) => bar !== null);
    if (assignBar) return { ok: false, error: `Not saved: ${assignBar}.` };
    const stale = (before?.characterIds ?? []).filter((cid) => !save.characterIds.includes(cid)).map((cid) => campaignCharacterKey(save.id, cid));
    const writes = redis.pipeline();
    if (characters.length) writes.mset(Object.fromEntries(characters.map((c) => [campaignCharacterKey(save.id, c.id), c])));
    if (stale.length) writes.del(...stale);
    writes.set(campaignKey(save.id), save);
    writes.hset(CAMPAIGN_INDEX_KEY, { [save.id]: { name: save.name, members: save.members, requests: row?.requests ?? {}, locked } });
    await writes.exec();
    return { ok: true, data: { members: save.members, savedAt: save.savedAt } };
  } catch (err) {
    console.error(`Error (${verb}) campaign:`, err);
    return { ok: false, error: `Failed to ${verb} campaign.` };
  }
}

// The campaign may be saved over again; only a GM unlocks it.
export async function unlockCampaign(id: string): Promise<ActionResult> {
  try {
    const [save, row, { profile, dev }] = await Promise.all([readCampaign(id), readCampaignRow(id), getViewer()]);
    if (!save || !row) return { ok: false, error: 'Campaign not found.' };
    if (!hasGmTools(getCampaignRole(save.members, profile, dev))) return { ok: false, error: 'Only a GM unlocks the campaign.' };
    const writes = redis.pipeline();
    writes.set(campaignKey(id), { ...save, locked: false });
    writes.hset(CAMPAIGN_INDEX_KEY, { [id]: { ...row, locked: false } });
    await writes.exec();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error unlocking campaign:', err);
    return { ok: false, error: 'Failed to unlock campaign.' };
  }
}

// The campaign with its characters.
export async function loadCampaign(id: string): Promise<ActionResult<{ save: CampaignSave, characters: unknown[] }>> {
  try {
    const [save, { profile, dev }] = await Promise.all([readCampaign(id), getViewer()]);
    if (!save) return { ok: false, error: 'Campaign not found.' };
    if (!dev && !(profile && profile in save.members)) return { ok: false, error: 'Only its members open a campaign.' };
    const keys = save.characterIds.map((cid) => campaignCharacterKey(id, cid));
    const characters = keys.length ? (await redis.mget<unknown[]>(...keys)).filter((c) => c !== null) : [];
    return { ok: true, data: { save, characters } };
  } catch (err) {
    console.error('Error loading campaign:', err);
    return { ok: false, error: 'Failed to load campaign.' };
  }
}

// The campaign goes with its characters; the library characters they were
// copied from keep their own records.
export async function deleteCampaign(id: string): Promise<ActionResult> {
  try {
    const [save, { profile, dev }] = await Promise.all([readCampaign(id), getViewer()]);
    if (save && !hasGmTools(getCampaignRole(save.members, profile, dev))) return { ok: false, error: 'Only a GM deletes the campaign.' };
    const deleteBar = getDeleteBar(save?.locked ?? false);
    if (deleteBar) return { ok: false, error: `Not deleted: ${deleteBar}.` };
    const own = (save?.characterIds ?? []).map((cid) => campaignCharacterKey(id, cid));
    const writes = redis.pipeline();
    writes.del(...own, campaignKey(id));
    writes.hdel(CAMPAIGN_INDEX_KEY, id);
    await writes.exec();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error deleting campaign:', err);
    return { ok: false, error: 'Failed to delete campaign.' };
  }
}


// ── collections ─────────────────────────────────────────────────────────
// Every collection is a field of one Redis hash, id -> the collection, which
// carries its owner and whom it is shared with.
const COLLECTIONS_KEY = 'collections';

async function readCollection(id: string): Promise<Collection | null> {
  const parsed = CollectionSchema.safeParse(await redis.hget(COLLECTIONS_KEY, id));
  return parsed.success ? parsed.data : null;
}

// The collections the profile at the screen sees: their own, those shared
// with them, and those shared with a campaign they play.
export async function getCollectionList(): Promise<ActionResult<Record<string, Collection>>> {
  try {
    const profile = await getProfileId();
    if (!profile) return { ok: true, data: {} };
    const [all, campaigns] = await Promise.all([readIndex(COLLECTIONS_KEY, CollectionSchema), readCampaignIndex()]);
    const plays = (campaign: string) => profile in (campaigns[campaign]?.members ?? {});
    return { ok: true, data: Object.fromEntries(Object.entries(all).filter(([, c]) => canReadCollection(c, profile, plays))) };
  } catch (err) {
    console.error('Error listing collections:', err);
    return { ok: false, error: 'Failed to list collections.' };
  }
}

// Only its owner saves a collection; a new one belongs to whoever saves it.
export async function saveCollection(raw: Collection): Promise<ActionResult<Collection>> {
  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Not a collection.' };
  try {
    const { profile, dev } = await getViewer();
    if (!profile) return { ok: false, error: 'Pick a profile first.' };
    const before = await readCollection(parsed.data.id);
    if (before && !isOwnerOrDev(before.owner, profile, dev)) return { ok: false, error: 'Only its owner changes this collection.' };
    const collection = { ...parsed.data, owner: before?.owner ?? profile };
    await redis.hset(COLLECTIONS_KEY, { [collection.id]: collection });
    return { ok: true, data: collection };
  } catch (err) {
    console.error('Error saving collection:', err);
    return { ok: false, error: 'Failed to save collection.' };
  }
}

export async function deleteCollection(id: string): Promise<ActionResult> {
  try {
    const { profile, dev } = await getViewer();
    const before = await readCollection(id);
    if (!before) return { ok: false, error: 'Collection not found.' };
    if (!isOwnerOrDev(before.owner, profile, dev)) return { ok: false, error: 'Only its owner deletes this collection.' };
    await redis.hdel(COLLECTIONS_KEY, id);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error('Error deleting collection:', err);
    return { ok: false, error: 'Failed to delete collection.' };
  }
}


// ── catalogs ────────────────────────────────────────────────────────────
// A catalog is one JSON file under app/assets keyed by entry; the domain
// imports it at build time, so this is content editing on a dev machine, the
// way base characters are, and the result is committed. What the form held
// is what gets written — validated against the catalog's schema, but not
// passed through it, so nothing a schema derives (a weapon attack's parsed
// properties) lands in the file.
const ASSET_DIR = path.join(process.cwd(), "app/assets");

async function readCatalog(file: string): Promise<Record<string, JsonValue>> {
  return JSON.parse(await fs.readFile(path.join(ASSET_DIR, file), "utf-8")) as Record<string, JsonValue>;
}

async function writeCatalog(file: string, catalog: Record<string, JsonValue>): Promise<void> {
  await fs.writeFile(path.join(ASSET_DIR, file), JSON.stringify(catalog, null, 2) + "\n", "utf-8");
}

export async function saveCatalogEntry(catalog: string, key: string, raw: unknown): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  if (!isCatalogName(catalog)) return { ok: false, error: 'No such catalog.' };
  const spec = CATALOGS[catalog];
  if (!key.trim()) return { ok: false, error: `${spec.label} need a name.` };
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  try {
    const entries = await readCatalog(spec.file);
    entries[key] = raw as JsonValue;
    await writeCatalog(spec.file, entries);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error(`Error writing ${spec.file}:`, err);
    return { ok: false, error: `Failed to save to ${spec.label}.` };
  }
}

export async function deleteCatalogEntry(catalog: string, key: string): Promise<ActionResult> {
  if (!isDevServer()) return DEV_ONLY;
  if (!isCatalogName(catalog)) return { ok: false, error: 'No such catalog.' };
  const spec = CATALOGS[catalog];
  try {
    const entries = await readCatalog(spec.file);
    if (!(key in entries)) return { ok: false, error: `No such entry in ${spec.label}.` };
    delete entries[key];
    await writeCatalog(spec.file, entries);
    return { ok: true, data: undefined };
  } catch (err) {
    console.error(`Error writing ${spec.file}:`, err);
    return { ok: false, error: `Failed to delete from ${spec.label}.` };
  }
}

// The VTT mailbox, from the app's side: what the board panel pushes and
// pulls. The route handler under app/api/vtt is the same mailbox from the
// VTT's side.
export async function publishBoard(fight: string, snapshot: BoardSnapshot): Promise<ActionResult> {
  try {
    const stored = await writeMailbox(fight, snapshot)
    return stored ? { ok: true, data: undefined } : { ok: false, error: 'Fight id must be letters, digits, - or _.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the mailbox.' }
  }
}

export async function fetchBoard(fight: string): Promise<ActionResult<unknown | null>> {
  try {
    return { ok: true, data: await readMailbox(fight) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach the mailbox.' }
  }
}
