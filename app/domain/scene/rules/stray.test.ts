import { describe, it, expect } from 'vitest'
import { TerrainCellSchema, type SceneState } from '../types'
import { makeAction } from '../factories'
import { makeCampaignCharacter } from '../../factories'
import { board as onBoard } from '../fixtures'
import { coordKey, distance, line, ring } from './board/geometry'
import { getStrayLanding } from './stray'

// combat.tex "Immobile Targets and Shooting Errors", with the user's rulings
// (2026-11-28): a missed shot goes as many spaces out from the target as its
// d6 says, the way its other d6 says (1 on along the line of fire), on the
// target's floor, and a wall stops it.

const fighter = (id: string) => ({ ...makeCampaignCharacter({ name: id }), id })
const FACES = [1, 2, 3, 4, 5, 6]
const shot = makeAction('shoot', { id: 's', actorId: 'a', targetId: 't' })
const TARGET = { q: 0, r: 0 }

const open = (): SceneState => {
  const s = onBoard({ a: [-3, 0], t: [0, 0] }, fighter('a'), fighter('t'))
  return { ...s, board: { ...s.board!, extent: { q: 12, r: 12, s: 12 } } }
}

// the scenario's premise: a ring of wall around the target, inside the
// farthest a d6 sends the shot
const WALL = 3
const walled = (): SceneState => {
  const s = open()
  const wall = Object.fromEntries(ring(TARGET, WALL).map((c) => [coordKey(c), TerrainCellSchema.parse({ blocking: true })]))
  return { ...s, board: { ...s.board!, terrain: wall } }
}

describe('a shot gone astray', () => {
  it('goes exactly as far as its d6 over open ground, the first way on along the shot', () => {
    const s = open()
    for (const d of FACES) {
      for (const way of FACES) {
        const landing = getStrayLanding(s, shot, d, way)
        expect(landing && distance(landing.cell, TARGET)).toBe(d)
      }
      const on = getStrayLanding(s, shot, d, 1)!
      expect(distance(on.cell, { q: -3, r: 0 })).toBe(3 + d)
    }
  })

  it('stops short of a wall and never lands in or past one', () => {
    const s = walled()
    for (const d of FACES) {
      for (const way of FACES) {
        const landing = getStrayLanding(s, shot, d, way)
        expect(landing).not.toBeNull()
        expect(distance(landing!.cell, TARGET)).toBe(Math.min(d, WALL - 1))
        expect(line(TARGET, landing!.cell).some((c) => s.board!.terrain[coordKey(c)]?.blocking)).toBe(false)
      }
    }
  })
})
