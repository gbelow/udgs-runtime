import { describe, it, expect } from 'vitest'
import { HazardLayerSchema, LevelCellSchema, TerrainCellSchema, type Coord, type SceneState } from '../types'
import { makeAction } from '../factories'
import { makeCampaignCharacter } from '../../factories'
import { produceEffects } from '../../character/rules/production'
import { SPELLS } from '../../spells'
import { board as onBoard } from '../../bot/fixtures'
import { coordKey, directionTo } from './board/geometry'
import { getAffected, getSprayPitch } from './explosion'
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

// The table's ruling: a cone opens as far up and down as across, about the
// tilt it was aimed at, toward a space at a height.
describe('a cone in height', () => {
  const cone = SPELLS.flamethrower.effects[0].area
  if (cone?.shape !== 'spray') throw new Error('flamethrower is not a spray')
  const flames = produceEffects(fighter('t'), SPELLS.flamethrower.effects)
  const half = (cone.angle / 2) * (Math.PI / 180)
  // the scenario's premise: a ledge one cell ahead, high enough to lie out of
  // a level cone and close enough to lie within its length
  const LEDGE = Math.floor(Math.tan(half)) + 1
  if (LEDGE > cone.length) throw new Error('the cone is too wide for a ledge within its length')

  const onLedge = (): SceneState => {
    const s = onBoard({ t: [0, 0], up: [1, 0] }, fighter('t'), fighter('up'))
    const terrain = { [coordKey({ q: 1, r: 0 })]: TerrainCellSchema.parse({ elevation: LEDGE }) }
    return { ...s, board: { ...s.board!, terrain, placements: { ...s.board!.placements, up: { ...s.board!.placements.up, elevation: LEDGE } } } }
  }
  const sprayed = (s: SceneState, pitch: number) => getAffected(s, makeAction('blast', { id: 'b', actorId: 't', direction: directionTo(CENTER, { q: 1, r: 0 }), pitch, effects: flames })).map((a) => a.id)

  it('misses someone on a ledge above it aimed level, and reaches them aimed at the ledge', () => {
    const s = onLedge()
    expect(sprayed(s, 0)).toEqual([])
    expect(sprayed(s, getSprayPitch(s, 't', { q: 1, r: 0 }))).toEqual(['up'])
  })
})
