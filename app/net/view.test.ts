import { describe, expect, it } from 'vitest'
import { makeCampaignCharacter } from '../domain/factories'
import { newFile } from '../domain/saves'
import { CampaignStateSchema } from '../domain/campaign/types'
import { ExplorationStateSchema } from '../domain/exploration/types'
import { DowntimeStateSchema } from '../domain/downtime/types'
import { SceneStateSchema } from '../domain/scene/types'
import { readShared, type Shared } from './protocol'
import { viewFor } from './view'

const NAMES: Record<string, string> = { a1: 'Aldric', a2: 'Aurelia', b1: 'Brunhild', c1: 'Cassian' }
const characters = Object.fromEntries(Object.entries(NAMES).map(([id, name]) => [id, makeCampaignCharacter({ name, id })]))

const table = (): Shared => ({
  scene: SceneStateSchema.parse({}),
  campaign: {
    ...CampaignStateSchema.parse({
      characters,
      parties: { pa: { name: 'Alder' }, pb: { name: 'Birch' }, pc: { name: 'Cedar' } },
      partyOf: { a1: 'pa', a2: 'pa', b1: 'pb', c1: 'pc' },
      names: { a1: 'Aldric', b1: 'Brunhild' },
      journal: [
        { id: 'j1', party: 'pa', title: 'Alder camps', lines: ['Aldric lights a fire'] },
        { id: 'j2', party: 'pb', title: 'Birch camps', lines: ['Brunhild lights a fire'] },
        { id: 'j3', party: null, title: 'Dawn', lines: ['the whole campaign wakes'] },
        { id: 'j4', party: 'pa', title: 'for the GM', gmOnly: true, lines: ['Aldric is cursed'] },
        { id: 'j5', party: 'pa', kind: 'fight', title: 'the log of a fight', lines: ['Cassian strikes'] },
      ],
    }),
    exploration: ExplorationStateSchema.parse({
      groups: { pa: { g: { kind: 'search', members: ['a1', 'a2'], roller: 'a1' } }, pb: { g: { kind: 'search', members: ['b1'], roller: 'b1' } } },
      camps: { pa: {}, pb: {} },
      resting: ['a2', 'b1'],
      casts: { b1: { key: 'x', targets: ['c1'] } },
      calls: { 'g:pa': { id: 'g:pa', roller: 'a1', label: 'search' }, 'g:pb': { id: 'g:pb', roller: 'b1', label: 'search' } },
      results: [{ party: 'pa', kind: 'search', members: ['a1', 'a2'], roll: null }, { party: 'pb', kind: 'search', members: ['b1'], roll: null }],
    }),
    downtime: DowntimeStateSchema.parse({
      plans: { a1: {}, b1: {}, c1: {} },
      results: [{ name: 'Aldric', what: 'job' }, { name: 'Brunhild', what: 'job' }],
    }),
    file: newFile('table', { gm: 'gm', alice: 'player', bob: 'player' }),
    owners: { a1: 'alice', a2: 'alice', b1: 'bob', c1: 'bob' },
  },
})

const viewers = ['alice', 'bob']

describe('the table as a guest is shown it', () => {
  it.each(viewers)('is the GM\'s whole state for the GM and a valid state for %s', (profile) => {
    const state = table()
    expect(viewFor(state, 'gm')).toBe(state)
    const view = viewFor(state, profile)
    expect(readShared(JSON.parse(JSON.stringify(view)))).toEqual(view)
  })

  // what each viewer plays, as ids: the others are not theirs to be told of
  it.each([['alice', ['b1', 'c1']], ['bob', ['a1', 'a2']]])('keeps %s from naming the characters of parties they are not in', (profile, left) => {
    const text = JSON.stringify(viewFor(table(), profile))
    for (const id of left) {
      expect(text).not.toContain(`"${id}"`)
      expect(text).not.toContain(NAMES[id])
    }
  })

  it('keeps the campaign\'s notes for the players, the GM\'s notes and a fight\'s log out of the journal', () => {
    const ids = viewFor(table(), 'alice').campaign.journal.map((e) => e.id)
    expect(ids).toEqual(['j1', 'j3'])
  })
})
