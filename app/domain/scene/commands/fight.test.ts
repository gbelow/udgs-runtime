import { describe, it, expect } from 'vitest'
import { returnFromFight, sendToFight } from './fight'
import { nextRound } from './nextRound'
import { getNextRoundBar } from '../rules/turn'
import { SceneStateSchema, type Table } from '../types'
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
    const first = sendToFight(['a', 'b'], () => 'issued')(table)
    expect(getNextRoundBar(first.fight)).toBeNull()
    const fought = { ...first, fight: nextRound(() => 0, () => 'issued')(first.fight) }
    const again = sendToFight(['a', 'b'], () => 'issued')(returnFromFight(0, () => 'issued')(fought))
    expect(getNextRoundBar(again.fight)).toBeNull()
  })
})
