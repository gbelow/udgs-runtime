import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, PlacementSchema, type Coord, type SceneState } from '../../types'
import { WINDOW_LIGHT } from '../../../tables'
import { coordKey, disk, ring, sameCell } from './geometry'
import { makeCampaignCharacter } from '../../../factories'
import { type CampaignCharacter } from '../../../types'
import { holdItem } from '../../../item/commands/hands'
import { getCatalogItem } from '../../../item/rules/items'
import { amendAction, commitAction, declareAction, resolveAction } from '../../commands/action'
import { getSenseReaches } from '../detection'
import { getOpenAction } from '../log'
import { getCellLight } from './light'

let n = 0
const newId = () => `l${++n}`

function caster(): CampaignCharacter {
  const base = makeCampaignCharacter({ name: 'c' })
  const torch = getCatalogItem('Alchemical Torch')!
  return { ...holdItem(torch)({ ...base, id: 'c', resources: { ...base.resources, AP: 30, STA: 10 } }), spells: { 'revealing-light': { method: 'intuitive' as const, practice: 6 } }, usedSurge: 'focus' as const }
}

function night(): SceneState {
  const state = SceneStateSchema.parse({ board: { placements: { c: PlacementSchema.parse({ cell: { q: 0, r: 0 } }) }, light: 'dark', extent: { q: 12, r: 12, s: 12 } } })
  return { ...state, characters: { c: caster() }, inTurnCharacter: 'c' }
}

// spells.tex "Revealing Light": "cast area=10m radius, duration=1 ET" — the
// alchemical torch it is cast with lights the ground around it for the rest
// of the fight (the table's ruling).
describe('Revealing Light', () => {
  it('lights the ground around its torch once cast', () => {
    const before = night()
    expect(getCellLight(before, { q: 8, r: 0 })).toBe('dark')
    let s = commitAction(() => 9, newId)(declareAction('c', { kind: 'cast', key: 'revealing-light' }, newId)(before))
    for (let i = 0; i < 10 && getOpenAction(s); i++) s = resolveAction(newId, () => 5)(s)
    expect(getOpenAction(s)).toBeNull()
    expect(getCellLight(s, { q: 8, r: 0 })).toBe('bright')
    expect(getCellLight(s, { q: 11, r: 0 })).toBe('dark')
  })
})

// gear.tex "Potions and Medicine": "Potions require a standard action to be
// consumed"; "Darkseeing": "Allows seeing in dim light at high quality for
// 1 ET".
describe('a Darkseeing potion', () => {
  function dusk(): SceneState {
    const base = makeCampaignCharacter({ name: 'd' })
    const drinker = holdItem(getCatalogItem('Darkseeing')!)({ ...base, id: 'd', resources: { ...base.resources, AP: 30, STA: 10 } })
    const target = { ...makeCampaignCharacter({ name: 't' }), id: 't' }
    const placements = { d: PlacementSchema.parse({ cell: { q: 0, r: 0 } }), t: PlacementSchema.parse({ cell: { q: 3, r: 0 } }) }
    return { ...SceneStateSchema.parse({ board: { placements, light: 'dim' } }), characters: { d: drinker, t: target }, inTurnCharacter: 'd' }
  }
  const visionOf = (state: SceneState) => getSenseReaches(state, 'd', 't').find((r) => r.sense === 'vision')?.impairment

  it('is gone once drunk, and the drinker sees clearly in dim light', () => {
    const before = dusk()
    expect(visionOf(before)).toBe('partial')
    const potion = before.characters.d.held.find((i) => i.name === 'Darkseeing')!
    let s = commitAction(() => 9, newId)(amendAction({ itemId: potion.id })(declareAction('d', { kind: 'drink' }, newId)(before)))
    for (let i = 0; i < 10 && getOpenAction(s); i++) s = resolveAction(newId, () => 5)(s)
    expect(getOpenAction(s)).toBeNull()
    expect(s.characters.d.held.some((i) => i.id === potion.id)).toBe(false)
    expect(visionOf(s)).toBe('none')
  })
})

// The table's ruling: a floor under a roof is dark but for the light outside
// that comes in through a window or a doorway, fading with distance from it,
// and a source's; a floor between keeps a source to its own storey.
describe('light under a roof', () => {
  const ROOM = WINDOW_LIGHT.fading + 2
  const FLOOR = 3
  const WINDOW = { q: ROOM + 1, r: 0 }
  const OUTSIDE = ROOM + 2
  const along = (q: number): Coord => ({ q, r: 0 })

  function house(window: boolean): SceneState {
    const terrain = Object.fromEntries(ring({ q: 0, r: 0 }, ROOM + 1).map((c) => [coordKey(c), window && sameCell(c, WINDOW) ? { blocking: true, transparent: true } : { blocking: true }]))
    const roof = Object.fromEntries(disk({ q: 0, r: 0 }, ROOM).map((c) => [coordKey(c), {}]))
    const board = BoardSchema.parse({ light: 'bright', extent: { q: ROOM + 4, r: ROOM + 4, s: ROOM + 4 }, terrain, levels: [{ floor: FLOOR, height: 3, terrain: roof }] })
    return { ...SceneStateSchema.parse({}), board }
  }

  function holding(state: SceneState, elevation: number): SceneState {
    const base = makeCampaignCharacter({ name: 't' })
    const t = { ...holdItem(getCatalogItem('Torch')!)(base), id: 't' }
    const placements = { t: PlacementSchema.parse({ cell: { q: 0, r: 0 }, elevation }) }
    return { ...state, characters: { t }, board: { ...state.board!, placements } }
  }

  it('is dark in a closed room under a bright sky, and bright on the roof', () => {
    const s = house(false)
    expect(getCellLight(s, along(0))).toBe('dark')
    expect(getCellLight(s, along(0), FLOOR)).toBe('bright')
  })

  it('takes the light outside through a window, fading away from it', () => {
    const s = house(true)
    expect(getCellLight(s, along(OUTSIDE - WINDOW_LIGHT.full))).toBe('bright')
    expect(getCellLight(s, along(OUTSIDE - WINDOW_LIGHT.fading))).toBe('dim')
    expect(getCellLight(s, along(OUTSIDE - WINDOW_LIGHT.fading - 1))).toBe('dark')
  })

  it('is lit by a source in the room, and not by one on the floor above', () => {
    const torch = Math.min(getCatalogItem('Torch')!.light!, ROOM)
    expect(getCellLight(holding(house(false), 0), along(torch))).toBe('bright')
    expect(getCellLight(holding(house(false), FLOOR), along(0))).toBe('dark')
    expect(getCellLight(holding(house(false), FLOOR), along(torch))).toBe('dark')
  })
})
