import { describe, it, expect } from 'vitest'
import { HazardLayerSchema, LevelCellSchema, TerrainCellSchema, type Coord, type SceneState } from '../types'
import { makeAction } from '../factories'
import { makeCampaignCharacter } from '../../factories'
import { produceEffects } from '../../character/rules/production'
import { SPELLS } from '../../spells'
import { board as onBoard } from '../../bot/fixtures'
import { coordKey } from './board/geometry'
import { getAffected } from './explosion'
import { getCellHazard } from './board/hazard'

const KEY = 'shock-explosive'
const area = SPELLS[KEY].effects[0].area
if (area?.shape !== 'explosion') throw new Error(`${KEY} is not an explosion`)
const { radius } = area

const fighter = (id: string) => ({ ...makeCampaignCharacter({ name: id }), id })
const effects = produceEffects(fighter('t'), SPELLS[KEY].effects)
const CENTER: Coord = { q: 0, r: 0 }
const blastAt = (floor: number | null) => makeAction('blast', { id: 'b', actorId: 't', center: CENTER, floor, effects })
const hit = (s: SceneState, floor: number | null) => getAffected(s, blastAt(floor)).map((a) => a.id).sort()

// The table's ruling: an explosion reaches as far up or down as across, and
// a solid floor between shuts it off.
describe('an explosion in height', () => {
  it('reaches no higher than its radius over open ground', () => {
    const s = onBoard({ t: [-(radius + 2), 0], low: [1, 0], high: [0, 1] }, fighter('t'), fighter('low'), fighter('high'))
    const pillar = TerrainCellSchema.parse({ elevation: radius + 1 })
    const board = { ...s.board!, terrain: { [coordKey({ q: 0, r: 1 })]: pillar }, placements: { ...s.board!.placements, high: { ...s.board!.placements.high, elevation: radius + 1 } } }
    expect(hit({ ...s, board }, null)).toEqual(['low'])
  })

  it('stays on its own side of a floor', () => {
    const FLOOR = 1
    const s = onBoard({ t: [-(radius + 2), 0], up: [1, 0], down: [0, 1] }, fighter('t'), fighter('up'), fighter('down'))
    const storey = Object.fromEntries([CENTER, { q: 1, r: 0 }, { q: 0, r: 1 }].map((c) => [coordKey(c), LevelCellSchema.parse({})]))
    const board = { ...s.board!, levels: [{ floor: FLOOR, height: 3, terrain: storey, piece: null }], placements: { ...s.board!.placements, up: { ...s.board!.placements.up, elevation: FLOOR } } }
    expect(hit({ ...s, board }, FLOOR)).toEqual(['up'])
    expect(hit({ ...s, board }, null)).toEqual(['down'])
  })
})

// The table's ruling: fire and gas stay on the floor they were left on.
describe('fire on a storey', () => {
  it('burns whoever stands on that floor, and not the ground under it', () => {
    const FLOOR = 3
    const s = onBoard({}, fighter('t'))
    const burning = LevelCellSchema.parse({ layers: [HazardLayerSchema.parse({ fire: 2 })] })
    const board = { ...s.board!, levels: [{ floor: FLOOR, height: 3, terrain: { [coordKey(CENTER)]: burning }, piece: null }] }
    expect(getCellHazard({ ...s, board }, CENTER, FLOOR).fire).toBeGreaterThan(0)
    expect(getCellHazard({ ...s, board }, CENTER).fire).toBe(0)
  })
})
