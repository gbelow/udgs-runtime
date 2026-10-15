import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from './factories'
import { CampaignStateSchema } from './campaign/types'
import { ExplorationStateSchema } from './exploration/types'
import { DowntimeStateSchema } from './downtime/types'
import { CampaignSaveSchema, fromCampaignSave, toCampaignSave, type CampaignInPlay } from './saves'

describe('a saved campaign', () => {
  it('comes back from storage as it was saved', () => {
    const t: CampaignInPlay = {
      campaign: CampaignStateSchema.parse({
        characters: { a: { ...makeCampaignCharacter({ name: 'A' }), id: 'a' } },
        partyOf: { a: 'p' },
        names: { a: 'A2' },
        parties: { p: { name: 'P', clock: 9, active: true, at: { map: 'm', node: 'n' } }, q: { name: 'Q' } },
        maps: { m: { name: 'M', nodes: { n: { name: 'N' } } } },
        journal: [{ id: '1', kind: 'et', party: 'p', partyName: 'P', clock: 9, title: 'an ET', lines: ['travel'] }, { id: '2', lines: ['a note'], gmOnly: true }],
        dayETs: 3,
      }),
      exploration: ExplorationStateSchema.parse({ resting: ['a'] }),
      downtime: DowntimeStateSchema.parse({}),
    }
    const members = { x: 'gm', y: 'player' } as const
    const stored = CampaignSaveSchema.parse(JSON.parse(JSON.stringify(toCampaignSave('id', 'name', members, t))))
    expect(stored.members).toEqual(members)
    const characters = Object.values(t.campaign.characters).map((c) => makeCampaignCharacter(JSON.parse(JSON.stringify(c))))
    expect(fromCampaignSave(stored, characters)).toEqual(t)
  })
})
