import { z } from 'zod'
import type { CampaignCharacter } from './types'
import { CampaignRecordSchema, CampaignStateSchema, type CampaignState } from './campaign/types'
import { ExplorationStateSchema, type ExplorationState } from './exploration/types'
import { DowntimeStateSchema, type DowntimeState } from './downtime/types'
import { nameByParty } from './campaign/commands/names'
import { CampaignMembersSchema, type CampaignMembers } from './profiles'

// A campaign as it is saved: who plays it, its own record, what exploration
// and downtime keep beside it, and the ids of its characters, saved apart.
// Read back best effort: a part that no longer parses comes back empty.
export const CampaignSaveSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  members: CampaignMembersSchema.catch({}),
  characterIds: z.array(z.string()).default([]),
  campaign: CampaignRecordSchema.catch(() => CampaignRecordSchema.parse({})),
  exploration: ExplorationStateSchema.catch(() => ExplorationStateSchema.parse({})),
  downtime: DowntimeStateSchema.catch(() => DowntimeStateSchema.parse({})),
})
export type CampaignSave = z.infer<typeof CampaignSaveSchema>

export type CampaignInPlay = { campaign: CampaignState; exploration: ExplorationState; downtime: DowntimeState }

// A campaign begun anew: nobody in it and nothing kept beside it.
export function newCampaign(): CampaignInPlay {
  return { campaign: CampaignStateSchema.parse({}), exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}) }
}

// Why the campaign cannot be saved now: it needs a name, and a fight is not
// saved, so whoever is in one is brought back first.
export function getCampaignSaveBar(name: string, fighting: boolean): string | null {
  if (!name.trim()) return 'name the campaign'
  return fighting ? 'end the fight first: a fight is not saved' : null
}

export function toCampaignSave(id: string, name: string, members: CampaignMembers, t: CampaignInPlay): CampaignSave {
  return { id, name, members, characterIds: Object.keys(t.campaign.characters), campaign: CampaignRecordSchema.parse(t.campaign), exploration: t.exploration, downtime: t.downtime }
}

// The campaign back in play with the characters found for it; one that was
// not found is out of every party and goes by no name, and one on a timeline
// the save has no name for is named (`nameByParty`).
export function fromCampaignSave(save: CampaignSave, characters: readonly CampaignCharacter[]): CampaignInPlay {
  const found = Object.fromEntries(characters.filter((c) => save.characterIds.includes(c.id)).map((c) => [c.id, c]))
  const partyOf = Object.fromEntries(Object.entries(save.campaign.partyOf).filter(([id]) => id in found))
  const names = Object.fromEntries(Object.entries(save.campaign.names).filter(([id]) => id in found))
  return {
    campaign: nameByParty(Object.keys(found))({ ...save.campaign, characters: found, activeCharacterId: null, partyOf, names, out: [] }),
    exploration: save.exploration,
    downtime: save.downtime,
  }
}
