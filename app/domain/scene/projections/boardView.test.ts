import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem } from '../../item/commands/hands'
import { pickThrowItem } from '../commands/floor'
import { laySurface } from '../commands/board'
import { extentCells } from '../rules/board/geometry'
import { getSurfaceChoices, getSurfaceNames } from '../rules/board/surface'
import { getBoardView } from './boardView'

// A throw was declared with the board locked, so where it lands could never
// be clicked and the throw never became committable.
describe('a throw being declared', () => {
  it('lets the board be clicked to aim it', () => {
    const base = makeCampaignCharacter({ name: 't' })
    const stone = ItemSchema.parse({ id: 'stone', name: 'stone', bulk: 0 })
    const thrower: CampaignCharacter = holdItem(stone)({ ...base, id: 't', resources: { ...base.resources, AP: 8 } })
    let s: SceneState = { ...SceneStateSchema.parse({ board: { placements: { t: { cell: { q: 0, r: 0 } } } } }), characters: { t: thrower }, inTurnCharacter: 't' }
    s = pickThrowItem('t', 'stone', () => 'throw')(s)
    const view = getBoardView({ ...s, activeCharacterId: null })
    expect(view.mode).toBe('aim')
    expect(view.cells.some((c) => c.center)).toBe(true)
  })
})

// The board draws its pictures in the order the view lists them, so a surface
// laid over another must come after it, and every cell must index one.
describe('the pictures of a board', () => {
  it('are listed lowest priority first and indexed by the cells that use them', () => {
    const names = getSurfaceNames()
    let s: SceneState = SceneStateSchema.parse({ board: {} })
    names.forEach((name, i) => { s = laySurface({ q: i, r: 0 }, name, i, null)(s) })
    const view = getBoardView({ ...s, activeCharacterId: null })
    const priorities = view.arts.map((a) => a.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
    for (const cell of view.cells) {
      if (cell.art !== null) expect(view.arts[cell.art]).toBeDefined()
    }
    expect(view.cells.filter((c) => c.art !== null).length).toBe(names.length)
  })

  // Pictures of equal priority were drawn in the order their first cell was
  // met, so editing one cell could flip which of two covered the other along
  // their whole border.
  it('are drawn in an order that does not depend on where the cells that use them lie', () => {
    const choices = getSurfaceChoices().flatMap(({ name, arts }) => arts.map((src) => ({ name, src })))
    const cells = extentCells({ q: 0, r: 0 }, { q: 6, r: 6, s: 6 }).slice(0, choices.length)
    const drawn = (at: typeof cells) => {
      let s: SceneState = SceneStateSchema.parse({ board: {} })
      choices.forEach(({ name, src }, i) => { s = laySurface(at[i], name, 0, src)(s) })
      return getBoardView({ ...s, activeCharacterId: null }).arts.map((a) => a.src)
    }
    const forward = drawn(cells)
    const backward = drawn([...cells].reverse())
    expect(backward).toEqual(forward)
  })
})
