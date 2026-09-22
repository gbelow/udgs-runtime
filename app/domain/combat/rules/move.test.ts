import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { getMoveCost, getMovementSpeed } from './move'

// combat.tex "Movement" — running: "The character can run a partial amount
// smaller than its running speed, but AP cost is the same"; jumping:
// "Movement cannot be voluntarily interrupted in the middle of a jump". A
// block of either is bought whole, however little of it is used.
describe('a partial block of a whole-block movement costs the block', () => {
  const runners = [
    makeCampaignCharacter({}),
    makeCampaignCharacter({ movement: { run: 2, jump: 1 } }),
    makeCampaignCharacter({ abilities: ['sprinter-1'] }),
  ]

  it.each(runners.map((c, i) => [i, c] as const))('runner %i', (_i, c) => {
    for (const kind of ['run', 'jump'] as const) {
      const speed = Math.floor(getMovementSpeed(c, kind))
      const whole = getMoveCost(c, kind, speed)
      for (let cells = 1; cells <= speed; cells++) expect(getMoveCost(c, kind, cells)).toEqual(whole)
    }
  })
})
