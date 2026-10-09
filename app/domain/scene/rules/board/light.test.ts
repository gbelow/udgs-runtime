import { describe, it, expect } from 'vitest'
import { SceneStateSchema, PlacementSchema, type SceneState } from '../../types'
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
  return { ...holdItem(torch)({ ...base, id: 'c', fightName: 'c', resources: { ...base.resources, AP: 30, STA: 10 } }), spells: { 'revealing-light': { method: 'intuitive' as const, practice: 6 } }, usedSurge: 'focus' as const }
}

function night(): SceneState {
  const state = SceneStateSchema.parse({ board: { placements: { c: PlacementSchema.parse({ cell: { q: 0, r: 0 } }) }, light: 'dark', radius: 12 } })
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
    for (let i = 0; i < 10 && getOpenAction(s); i++) s = resolveAction(newId)(s)
    expect(getOpenAction(s)).toBeNull()
    expect(getCellLight(s, { q: 8, r: 0 })).toBe('bright')
    expect(getCellLight(s, { q: 11, r: 0 })).toBe('dark')
  })
})

// gear.tex "Potions and Medicine": "Potions require a standard action to be
// consumed"; "Darkseeing": "Allows seeing in dim light at high quality" — for
// the rest of the fight (the table's ruling for "1 ET").
describe('a Darkseeing potion', () => {
  function dusk(): SceneState {
    const base = makeCampaignCharacter({ name: 'd' })
    const drinker = holdItem(getCatalogItem('Darkseeing')!)({ ...base, id: 'd', fightName: 'd', resources: { ...base.resources, AP: 30, STA: 10 } })
    const target = { ...makeCampaignCharacter({ name: 't' }), id: 't', fightName: 't' }
    const placements = { d: PlacementSchema.parse({ cell: { q: 0, r: 0 } }), t: PlacementSchema.parse({ cell: { q: 3, r: 0 } }) }
    return { ...SceneStateSchema.parse({ board: { placements, light: 'dim' } }), characters: { d: drinker, t: target }, inTurnCharacter: 'd' }
  }
  const visionOf = (state: SceneState) => getSenseReaches(state, 'd', 't').find((r) => r.sense === 'vision')?.impairment

  it('is gone once drunk, and the drinker sees clearly in dim light', () => {
    const before = dusk()
    expect(visionOf(before)).toBe('partial')
    const potion = before.characters.d.held.find((i) => i.potion === 'darkseeing')!
    let s = commitAction(() => 9, newId)(amendAction({ itemId: potion.id })(declareAction('d', { kind: 'drink' }, newId)(before)))
    for (let i = 0; i < 10 && getOpenAction(s); i++) s = resolveAction(newId)(s)
    expect(getOpenAction(s)).toBeNull()
    expect(s.characters.d.held.some((i) => i.id === potion.id)).toBe(false)
    expect(visionOf(s)).toBe('none')
  })
})
