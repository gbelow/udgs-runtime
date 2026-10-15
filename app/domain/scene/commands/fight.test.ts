import { describe, it, expect } from 'vitest'
import { loadIntoFight, loadOntoRoster, removeFromFight, resetFight, returnFromFight, sendPartyToFight, sendToFight } from './fight'
import { passRound } from '../../bot/table'
import { endCombat } from './endCombat'
import { getNextRoundBar } from '../rules/turn'
import { SceneStateSchema, type Table, type TableUpdater } from '../types'
import { CampaignStateSchema } from '../../campaign/types'
import { makeCampaignCharacter } from '../../factories'

describe('starting a fight', () => {
  // "start combat" waited for everyone to agree to end a round that had not
  // begun, so characters with STA for a surge could never start a fight —
  // nor start the next one after ending the last.
  it('is open before the first round, and again once a fight is ended', () => {
    const a = { ...makeCampaignCharacter({ name: 'a' }), id: 'a' }
    const rested = { ...a, resources: { ...a.resources, STA: 10 } }
    const b = { ...makeCampaignCharacter({ name: 'b' }), id: 'b' }
    const table: Table = { campaign: CampaignStateSchema.parse({ characters: { a: rested, b } }), fight: SceneStateSchema.parse({}) }
    const first = sendToFight(['a', 'b'])(table)
    expect(getNextRoundBar(first.fight)).toBeNull()
    const fought = { ...first, fight: passRound(() => 0)(first.fight) }
    const ended = { ...fought, fight: endCombat(() => 0)(fought.fight) }
    const again = sendToFight(['a', 'b'])(returnFromFight(['a', 'b'], 0)(ended))
    expect(getNextRoundBar(again.fight)).toBeNull()
  })
})

// The table's promise: nobody sent to a fight from the roster is lost — they
// come back under the id they left with, in the party they left in, whatever
// is loaded, sent, removed or reset in between.
describe('a character sent to a fight', () => {
  const a = { ...makeCampaignCharacter({ name: 'a' }), id: 'a' }
  const b = { ...makeCampaignCharacter({ name: 'b' }), id: 'b' }
  let n = 0
  const newId = () => `issued-${n++}`
  // another copy of a's sheet, under a's id
  const again = { ...a, name: 'a again' }
  const send: TableUpdater = sendToFight(['a', 'b'])
  const back: TableUpdater = returnFromFight(['a', 'b'], 0)
  const scenarios: Record<string, TableUpdater[]> = {
    'fought and returned': [send, back],
    'whose sheet is loaded onto the roster while away': [send, loadOntoRoster(again, newId), back],
    'whose sheet was loaded into the fight first': [loadIntoFight(again, newId), send, back],
    'whose sheet is loaded into the fight while there': [send, loadIntoFight(again, newId), back],
    'removed from the fight': [send, removeFromFight('a'), back],
    'in a fight that is reset': [send, resetFight],
    'returned and sent again': [send, back, send, back],
    'returned one at a time': [send, returnFromFight(['a'], 0), returnFromFight(['b'], 0)],
  }
  it.each(Object.entries(scenarios))('comes back, %s', (_name, steps) => {
    const start: Table = {
      campaign: CampaignStateSchema.parse({ characters: { a, b }, parties: { p: { name: 'Party 1' } }, partyOf: { a: 'p', b: 'p' } }),
      fight: SceneStateSchema.parse({}),
    }
    const end = steps.reduce((t, step) => step(t), start)
    expect([end.campaign.characters.a?.name, end.campaign.characters.b?.name]).toEqual(['a', 'b'])
    expect([end.campaign.partyOf.a, end.campaign.partyOf.b]).toEqual(['p', 'p'])
  })
})

// The table's promise: the ETs a scene took pass once for a party, whether
// its fighters come back together or one at a time.
describe('the time a scene took', () => {
  it('passes once for a party, however its fighters come back', () => {
    const a = { ...makeCampaignCharacter({ name: 'a' }), id: 'a' }
    const b = { ...makeCampaignCharacter({ name: 'b' }), id: 'b' }
    const start: Table = {
      campaign: CampaignStateSchema.parse({ characters: { a, b }, parties: { p: { name: 'P', clock: 0, active: true } }, partyOf: { a: 'p', b: 'p' } }),
      fight: SceneStateSchema.parse({}),
    }
    const sent = sendPartyToFight('p')(start)
    const together = returnFromFight(['a', 'b'], 2)(sent)
    const apart = returnFromFight(['b'], 2)(returnFromFight(['a'], 2)(sent))
    expect(apart.campaign.parties.p.clock).toBe(together.campaign.parties.p.clock)
  })
})
