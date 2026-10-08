import { describe, it, expect } from 'vitest'
import { withInstance } from './instances'
import { makeCampaignCharacter } from './factories'

// Adding the same character sheet to a fight twice replaced the first copy:
// makeCampaignCharacter carries the incoming id through, and the combat store
// keys its characters by that id, so the second add overwrote the first.
describe('withInstance', () => {
  it('issues a duplicate copy an id the record is not already using', () => {
    const sheet = makeCampaignCharacter({ name: 'Bob' })

    const once = withInstance(sheet, {}, () => 'issued-1')
    const twice = withInstance(sheet, once, () => 'issued-2')

    expect(Object.keys(twice)).toEqual([sheet.id, 'issued-2'])
  })
})
