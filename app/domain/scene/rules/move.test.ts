import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { getMovementSpeed } from '../../character/rules/movement'
import { getEvasiveJumpPlacements, getMoveCost } from './move'
import { board as onBoard, fighter } from '../../bot/fixtures'
import { TerrainCellSchema } from '../types'
import { directionTo, distance } from './board/geometry'

// combat.tex "Movement" — running: "The character can run a partial amount
// smaller than its running speed, but AP cost is the same"; jumping:
// "Movement cannot be voluntarily interrupted in the middle of a jump". A
// block of either is bought whole, however little of it is used.
describe('a partial block of a whole-block movement costs the block', () => {
  const runners = [
    makeCampaignCharacter({}),
    makeCampaignCharacter({ movement: { run: 2, jump: 1 } }),
    makeCampaignCharacter({ abilities: { sprinter: { value: 1 } } }),
  ]

  it.each(runners.map((c, i) => [i, c] as const))('runner %i', (_i, c) => {
    for (const kind of ['run', 'jump'] as const) {
      const speed = Math.floor(getMovementSpeed(c, kind))
      const whole = getMoveCost(c, kind, speed)
      for (let cells = 1; cells <= speed; cells++) expect(getMoveCost(c, kind, cells)).toEqual(whole)
    }
  })
})

// The evasive jump landed anywhere in its reach without asking what stood in
// the way, so a thin wall in the jumper's own cell did not keep them from
// jumping out through it.
describe('an evasive jump goes over the ground on its way like any jump', () => {
  it('does not leave through the thin wall of its own cell', () => {
    const s = onBoard({ atk: [-1, 0], def: [0, 0] }, fighter('atk'), fighter('def'))
    const open = getEvasiveJumpPlacements(s, 'def', 'atk').filter((p) => distance(p.cell, { q: 0, r: 0 }) === 1)
    expect(open.length).toBeGreaterThan(0)
    for (const { cell } of open) {
      const corner = (6 - directionTo({ q: 0, r: 0 }, cell)) % 6
      const walled = { ...s, board: { ...s.board!, terrain: { '0,0': TerrainCellSchema.parse({ chords: [corner] }) } } }
      expect(getEvasiveJumpPlacements(walled, 'def', 'atk').map((p) => p.cell)).not.toContainEqual(cell)
    }
  })
})
