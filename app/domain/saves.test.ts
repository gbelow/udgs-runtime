import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from './factories'
import { CampaignStateSchema } from './campaign/types'
import { ExplorationStateSchema } from './exploration/types'
import { DowntimeStateSchema } from './downtime/types'
import { SceneStateSchema } from './scene/types'
import { sendToFight } from './scene/commands/fight'
import { CampaignSaveSchema, fromCampaignSave, newFile, toStoredCampaign, type CampaignFileInfo, type CampaignInPlay, type CampaignSave } from './saves'

// What the server writes and reads back: the save and the characters' records.
function throughStorage(t: CampaignInPlay, file: CampaignFileInfo = newFile('id')): [CampaignSave, CampaignInPlay] {
  const { save, characters } = toStoredCampaign(file, t)
  const stored = CampaignSaveSchema.parse(JSON.parse(JSON.stringify(save)))
  return [stored, fromCampaignSave(stored, characters.map((c) => makeCampaignCharacter(JSON.parse(JSON.stringify(c)))))]
}

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
      fight: SceneStateSchema.parse({}),
    }
    const members = { x: 'gm', y: 'player' } as const
    const [stored, back] = throughStorage(t, newFile('id', members))
    expect(stored.members).toEqual(members)
    expect(back).toEqual(t)
  })

  it('comes back in the middle of a fight, with whoever was sent to it still in it', () => {
    const campaign = CampaignStateSchema.parse({
      characters: { a: { ...makeCampaignCharacter({ name: 'A' }), id: 'a' }, b: { ...makeCampaignCharacter({ name: 'B' }), id: 'b' } },
      partyOf: { a: 'p', b: 'p' },
      names: { a: 'A', b: 'B' },
      parties: { p: { name: 'P', clock: 9, active: true } },
    })
    const table = sendToFight(['a'])({ campaign, fight: SceneStateSchema.parse({}) })
    const t: CampaignInPlay = { ...table, exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}) }
    expect(throughStorage(t)[1]).toEqual(t)
  })
})
