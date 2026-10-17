import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { CampaignStateSchema } from '../../campaign/types'
import { ExplorationStateSchema } from '../types'
import { answerET, passET } from './exploration'
import { toTable } from '../../play/calls'

// An ET where nobody went on an exploration action (one rested, one stayed
// idle) moved the clock but left no journal entry.
describe('an ET spent in camp', () => {
  it('is recorded for the party', () => {
    const campaign = CampaignStateSchema.parse({
      characters: { r: makeCampaignCharacter({ name: 'R' }), i: makeCampaignCharacter({ name: 'I' }) },
      partyOf: { r: 'p', i: 'p' },
      parties: { p: { name: 'P', clock: 0, active: true, sequence: 'exploration' } },
    })
    const passed = passET(() => 5, () => 'new')({ campaign, exploration: ExplorationStateSchema.parse({ resting: ['r'] }) })
    expect(passed.campaign.journal.filter((e) => e.kind === 'et' && e.party === 'p')).toHaveLength(1)
  })
})

// A die is rolled when the test calls for it: the ET waits on it, and what was
// typed in is what the test was made with.
describe('an ET that calls for a die', () => {
  it('passes only once the die is entered, with that die', () => {
    const campaign = CampaignStateSchema.parse({
      characters: { w: makeCampaignCharacter({ name: 'W', resources: { exhaustion: 12 } }) },
      partyOf: { w: 'p' },
      parties: { p: { name: 'P', clock: 0, active: true, sequence: 'exploration' } },
    })
    const called = passET(toTable(() => 5), () => 'new')({ campaign, exploration: ExplorationStateSchema.parse({ resting: ['w'] }) })
    expect(called.campaign.parties.p.clock).toBe(0)
    const [call] = Object.values(called.exploration.calls)
    const passed = answerET(call.id, 7, 'entered', () => 5, () => 'new')(called)
    expect(passed.campaign.parties.p.clock).toBe(1)
    expect(passed.exploration.exhaustionRolls.w).toMatchObject({ die: 7, source: 'entered' })
  })
})
