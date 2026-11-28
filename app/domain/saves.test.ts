import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from './factories'
import { CampaignStateSchema } from './campaign/types'
import { ExplorationStateSchema } from './exploration/types'
import { DowntimeStateSchema } from './downtime/types'
import { SceneStateSchema } from './scene/types'
import { loadIntoFight, sendToFight } from './scene/commands/fight'
import { CampaignSaveSchema, fromCampaignSave, newFile, readFallen, readGround, toStoredCampaign, type CampaignFileInfo, type CampaignInPlay, type CampaignSave } from './saves'

// What the server writes and reads back: the save, the characters' records,
// and what the save keeps apart.
function throughStorage(t: CampaignInPlay, file: CampaignFileInfo = newFile('id')): [CampaignSave, CampaignInPlay] {
  const { save, characters, fallen, ground } = toStoredCampaign(file, t)
  const json = (v: unknown) => JSON.parse(JSON.stringify(v))
  const stored = CampaignSaveSchema.parse(json(save))
  return [stored, fromCampaignSave(stored, characters.map((c) => makeCampaignCharacter(json(c))), readFallen(json(fallen), json(save)), readGround(json(ground)))]
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
        fallen: { 'm:n': [{ ...makeCampaignCharacter({ name: 'D' }), id: 'd' }] },
      }),
      exploration: ExplorationStateSchema.parse({ resting: ['a'] }),
      downtime: DowntimeStateSchema.parse({}),
      fight: SceneStateSchema.parse({ board: { terrain: { '0,0': {} }, levels: [{}] } }),
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

describe('the dead, saved', () => {
  // a campaign that held its dead whole in the save grew past what a server
  // action takes; an older save read now still brings them back
  it('come back from an older save that holds them whole', () => {
    const dead = { ...makeCampaignCharacter({ name: 'D' }), id: 'd' }
    const t: CampaignInPlay = {
      campaign: CampaignStateSchema.parse({ fallen: { '': [dead] } }),
      exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}), fight: SceneStateSchema.parse({}),
    }
    const { save } = toStoredCampaign(newFile('id'), t)
    const older = JSON.parse(JSON.stringify({ ...save, campaign: { ...save.campaign, fallen: { '': [dead] } } }))
    const back = fromCampaignSave(CampaignSaveSchema.parse(older), [], readFallen(undefined, older))
    expect(back.campaign.fallen).toEqual(t.campaign.fallen)
  })
})

describe('who plays whom, saved', () => {
  // the owners kept were only the campaign's records, so a character brought
  // straight into the fight and given to a bot lost its bot when the campaign
  // was resumed from its autosave, and the bots stopped playing.
  it('is kept for one brought straight into the fight', () => {
    const empty = CampaignStateSchema.parse({})
    const orc = { ...makeCampaignCharacter({ name: 'orc' }), id: 'orc' }
    const { campaign, fight } = loadIntoFight(orc, () => 'orc')({ campaign: empty, fight: SceneStateSchema.parse({}) })
    const t: CampaignInPlay = { campaign, exploration: ExplorationStateSchema.parse({}), downtime: DowntimeStateSchema.parse({}), fight }
    const { save } = toStoredCampaign(newFile('id'), t, { orc: 'bot:threat' })
    expect(CampaignSaveSchema.parse(JSON.parse(JSON.stringify(save))).owners).toEqual({ orc: 'bot:threat' })
  })
})
