import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem } from '../../item/commands/hands'
import { pickThrowItem } from '../commands/floor'
import { getBoardView } from './boardView'

// A throw was declared with the board locked, so where it lands could never
// be clicked and the throw never became committable.
describe('a throw being declared', () => {
  it('lets the board be clicked to aim it', () => {
    const base = makeCampaignCharacter({ name: 't' })
    const stone = ItemSchema.parse({ id: 'stone', name: 'stone', bulk: 0 })
    const thrower: CampaignCharacter = holdItem(stone)({ ...base, id: 't', resources: { ...base.resources, AP: 8 } })
    let s: CombatState = { ...CombatStateSchema.parse({ board: { placements: { t: { cell: { q: 0, r: 0 } } } } }), characters: { t: thrower }, inTurnCharacter: 't' }
    s = pickThrowItem('t', 'stone', () => 'throw')(s)
    const view = getBoardView(s)
    expect(view.mode).toBe('aim')
    expect(view.cells.some((c) => c.center)).toBe(true)
  })
})
