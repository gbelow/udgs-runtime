import { describe, it, expect } from 'vitest'
import { loadIntoFight } from './scene/commands/fight'
import { SceneStateSchema } from './scene/types'
import { CampaignStateSchema } from './campaign/types'
import { makeCampaignCharacter } from './factories'

// Adding the same character sheet to a fight twice replaced the first copy:
// makeCampaignCharacter carries the incoming id through, and the combat store
// keys its characters by that id, so the second add overwrote the first.
describe('loading a sheet twice', () => {
  it('issues the second copy an id the fight is not already using', () => {
    const sheet = makeCampaignCharacter({ name: 'Bob' })
    const load = loadIntoFight(sheet, () => 'issued-2')
    const table = load(load({ campaign: CampaignStateSchema.parse({}), fight: SceneStateSchema.parse({}) }))

    expect(Object.keys(table.fight.characters)).toEqual([sheet.id, 'issued-2'])
  })
})
