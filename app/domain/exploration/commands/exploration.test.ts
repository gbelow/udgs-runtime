import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { CampaignStateSchema } from '../../campaign/types'
import { ExplorationStateSchema } from '../types'
import { passET } from './exploration'

// An ET where nobody went on an exploration action (one rested, one stayed
// idle) moved the clock but left no journal entry.
describe('an ET spent in camp', () => {
  it('is recorded for the party', () => {
    const campaign = CampaignStateSchema.parse({
      characters: { r: makeCampaignCharacter({ name: 'R' }), i: makeCampaignCharacter({ name: 'I' }) },
      partyOf: { r: 'p', i: 'p' },
      parties: { p: { name: 'P', clock: 0, active: true } },
    })
    const passed = passET(() => 5, () => 'new')({ campaign, exploration: ExplorationStateSchema.parse({ resting: ['r'] }) })
    expect(passed.campaign.journal.filter((e) => e.kind === 'et' && e.party === 'p')).toHaveLength(1)
  })
})
