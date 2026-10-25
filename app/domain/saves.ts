import { z } from 'zod'
import type { CampaignCharacter } from './types'
import { CampaignRecordSchema, CampaignStateSchema, type CampaignRecord, type CampaignState } from './campaign/types'
import { ExplorationStateSchema, type ExplorationState } from './exploration/types'
import { DowntimeStateSchema, type DowntimeState } from './downtime/types'
import { SceneStateSchema, type SceneState } from './scene/types'
import { isFromRoster } from './scene/rules/fight'
import { nameByParty } from './campaign/commands/names'
import { CampaignMembersSchema, CharacterOwnersSchema, type CampaignMembers, type CharacterOwners } from './profiles'

// A campaign as it is saved: who plays it, its own record, what exploration
// and downtime keep beside it, the fight being played out, the ids of its
// characters, saved apart, and the profile that plays each. A locked campaign
// is never saved over: play on it is saved as a copy, which names the
// campaign it was copied from. `savedAt` is when the server last wrote it.
// Read back best effort: a part that no longer parses comes back empty.
export const CampaignSaveSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  members: CampaignMembersSchema.catch({}),
  characterIds: z.array(z.string()).default([]),
  owners: CharacterOwnersSchema.catch({}),
  campaign: CampaignRecordSchema.catch(() => CampaignRecordSchema.parse({})),
  exploration: ExplorationStateSchema.catch(() => ExplorationStateSchema.parse({})),
  downtime: DowntimeStateSchema.catch(() => DowntimeStateSchema.parse({})),
  fight: SceneStateSchema.catch(() => SceneStateSchema.parse({})),
  locked: z.boolean().catch(false),
  copiedFrom: z.string().nullable().catch(null),
  savedAt: z.number().catch(0),
})
export type CampaignSave = z.infer<typeof CampaignSaveSchema>

export type CampaignInPlay = { campaign: CampaignState; exploration: ExplorationState; downtime: DowntimeState; fight: SceneState }

// Which saved campaign is in play and how it stands in storage, beside what
// it holds.
const FILE_KEYS = { id: true, name: true, members: true, locked: true, copiedFrom: true, savedAt: true } as const
export type CampaignFileInfo = Pick<CampaignSave, keyof typeof FILE_KEYS>

// A campaign begun anew: nobody in it and nothing kept beside it.
export function newCampaign(): CampaignInPlay {
  return { campaign: CampaignStateSchema.parse({}), exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}), fight: SceneStateSchema.parse({}) }
}

// A campaign never saved, under `id`, played by `members`.
export function newFile(id: string, members: CampaignMembers = {}): CampaignFileInfo {
  return { id, name: '', members, locked: false, copiedFrom: null, savedAt: 0 }
}

// Why the campaign cannot be saved now.
export function getCampaignSaveBar(name: string): string | null {
  return name.trim() ? null : 'name the campaign'
}

// Why the campaign cannot be saved over: a locked one is saved as a copy.
export function getOverwriteBar(locked: boolean): string | null {
  return locked ? 'the campaign is locked: save it as a copy' : null
}

// Why the campaign cannot be locked: a locked campaign starts with nobody
// fighting.
export function getLockBar(name: string, fight: SceneState): string | null {
  return getCampaignSaveBar(name) ?? (isFighting(fight) ? 'a locked campaign starts with no fight: drop the fight first' : null)
}

function isFighting(fight: SceneState): boolean {
  return Object.keys(fight.characters).length > 0
}

// Why the campaign cannot be deleted.
export function getDeleteBar(locked: boolean): string | null {
  return locked ? 'unlock the campaign first' : null
}

// Whoever the campaign keeps a record of: everyone on the roster, and
// everyone it sent to the fight, as the fight has them. Whoever was brought
// straight into the fight lives in the fight alone.
function getSavedCharacters(t: CampaignInPlay): CampaignCharacter[] {
  const table = { campaign: t.campaign, fight: t.fight }
  return [...Object.values(t.campaign.characters), ...Object.values(t.fight.characters).filter((c) => isFromRoster(table, c.id))]
}

// What is written for the campaign in play: its save, and the records of the
// characters it names.
export type StoredCampaign = { save: CampaignSave; characters: CampaignCharacter[] }

const SCENE_KEYS = Object.keys(SceneStateSchema.shape) as (keyof SceneState)[]
const RECORD_KEYS = Object.keys(CampaignRecordSchema.shape) as (keyof CampaignRecord)[]
const pick = <T extends object>(from: T, keys: readonly (keyof T)[]) => Object.fromEntries(keys.map((k) => [k, from[k]])) as T

export function toStoredCampaign(file: CampaignFileInfo, t: CampaignInPlay, owners: CharacterOwners = {}): StoredCampaign {
  const characters = getSavedCharacters(t)
  const characterIds = characters.map((c) => c.id)
  const save: CampaignSave = {
    ...toFileInfo(file), characterIds,
    owners: Object.fromEntries(Object.entries(owners).filter(([cid]) => characterIds.includes(cid))),
    campaign: pick<CampaignRecord>(t.campaign, RECORD_KEYS), exploration: t.exploration, downtime: t.downtime,
    fight: pick(t.fight, SCENE_KEYS),
  }
  return { save, characters }
}

export function toFileInfo(from: CampaignFileInfo): CampaignFileInfo {
  return pick(from, Object.keys(FILE_KEYS) as (keyof CampaignFileInfo)[])
}

// The campaign back in play with the characters found for it; whoever is in
// the saved fight stays in it, and whoever the campaign sent to a fight that
// did not come back is on the roster again. One that was not found is out of
// every party and goes by no name, and one on a timeline the save has no name
// for is named (`nameByParty`).
export function fromCampaignSave(save: CampaignSave, characters: readonly CampaignCharacter[]): CampaignInPlay {
  const fighting = (id: string) => id in save.fight.characters
  const found = Object.fromEntries(characters.filter((c) => save.characterIds.includes(c.id) && !fighting(c.id)).map((c) => [c.id, c]))
  const known = (id: string) => id in found || fighting(id)
  const partyOf = Object.fromEntries(Object.entries(save.campaign.partyOf).filter(([id]) => known(id)))
  const names = Object.fromEntries(Object.entries(save.campaign.names).filter(([id]) => known(id)))
  return {
    campaign: nameByParty(Object.keys(found))({ ...save.campaign, characters: found, partyOf, names, lent: save.campaign.lent.filter(fighting) }),
    exploration: save.exploration,
    downtime: save.downtime,
    fight: save.fight,
  }
}

// Whether there is anything to keep of a campaign never saved: anyone in it,
// a party, a map or a journal entry.
export function hasPlay(t: CampaignInPlay): boolean {
  const { characters, parties, maps, journal } = t.campaign
  return isFighting(t.fight) || Object.keys(characters).length + Object.keys(parties).length + Object.keys(maps).length + journal.length > 0
}

// The campaign in play saved as a new campaign of its own: under a new id
// and name, unlocked, naming the campaign it was copied from.
export function asCopy(file: CampaignFileInfo, id: string, name: string): CampaignFileInfo {
  return { ...file, id, name, locked: false, copiedFrom: file.id, savedAt: 0 }
}
