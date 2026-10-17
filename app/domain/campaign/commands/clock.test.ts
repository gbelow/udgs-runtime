import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { CampaignStateSchema, type CampaignState } from '../types'
import { getPlacement } from '../projections/timeline'
import { passTimeTo, placeOnTimeline } from './clock'
import { ExplorationStateSchema } from '../../exploration/types'
import { passET } from '../../exploration/commands/exploration'

const c = (name: string) => makeCampaignCharacter({ name })

// Parties on every kind of timeline: ahead, behind, level, outside time, out
// of play.
function campaign(): CampaignState {
  return CampaignStateSchema.parse({
    characters: { a: c('A'), b: c('B'), e: c('E'), s: c('S'), l: c('L') },
    partyOf: { a: 'ahead', b: 'behind', e: 'encounter', s: 'shelved', l: 'level' },
    parties: {
      ahead: { name: 'Ahead', clock: 40, active: true },
      behind: { name: 'Behind', clock: 7, active: true },
      level: { name: 'Level', clock: 40, active: true },
      encounter: { name: 'Encounter', clock: null, active: true },
      shelved: { name: 'Shelved', clock: 3, active: false },
    },
  })
}

// The user's ruling: a sync brings a party forward to a moment, never back,
// and does what the option offered says.
describe('placing on the timeline', () => {
  it('lands every offered option where it says, and offers nothing back in time', () => {
    const state = campaign()
    for (const partyId of Object.keys(state.parties)) {
      for (const to of [0, 7, 40, 41, 90]) {
        const { options, bar } = getPlacement(state.parties, partyId, to)
        const before = state.parties[partyId].clock
        for (const option of options) {
          const synced = (option.how === 'place' ? placeOnTimeline : passTimeTo)(partyId, to)(state)
          expect(synced.parties[partyId].clock, `${partyId} ${option.how} ${to}`).toBe(to)
          if (before !== null) expect(to).toBeGreaterThan(before)
        }
        if (bar) expect(options).toEqual([])
      }
    }
  })

  it('refuses to bring a party back', () => {
    const state = campaign()
    expect(placeOnTimeline('ahead', 7)(state)).toBe(state)
    expect(passTimeTo('ahead', 7)(state)).toEqual(state)
  })
})

// The user's ruling: only parties in play on a timeline feel time pass;
// whoever is outside time or out of play is left as they were.
describe('time passing', () => {
  it('leaves the parties not playing and their members alone', () => {
    const state = campaign()
    const still = (s: CampaignState) => ({ encounter: s.parties.encounter, shelved: s.parties.shelved, e: s.characters.e, s: s.characters.s })
    const explored = passET(() => 5, () => 'new')({ campaign: state, exploration: ExplorationStateSchema.parse({}) })
    expect(explored.campaign.parties.behind.clock).toBe(8)
    expect(still(explored.campaign)).toEqual(still(state))
  })
})
