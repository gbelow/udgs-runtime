import { describe, it, expect } from 'vitest'
import { BoardSchema, PlacementSchema, SceneStateSchema, type Coord, type SeenScene } from '../types'
import { FALL } from '../../tables'
import { makeCampaignCharacter } from '../../factories'
import { getHeight } from '../../character/rules/size'
import { coordKey } from '../rules/board/geometry'
import { getBoardViewFrom } from './boardView'
import { getStoreyView, getViewEye, getViewHeight } from './storeyView'

// A room upstairs runs along r = 0 from q = 0 to q = 2, its floor higher than
// anyone on the ground is tall, its outer wall the ground's wall at q = 3
// standing up past the floor; a stair's top step at q = -1 rises to a step
// under the floor, a stairwell over it.
const someone = { ...makeCampaignCharacter({ name: 'a' }), id: 'a' }
const STEP = FALL.minHeight / 2
const FLOOR = getHeight(someone) + FALL.minHeight
const cell = (q: number): Coord => ({ q, r: 0 })
const board = BoardSchema.parse({
  terrain: { [coordKey(cell(3))]: { blocking: true }, [coordKey(cell(-1))]: { elevation: FLOOR - STEP } },
  levels: [{
    floor: FLOOR,
    terrain: { ...Object.fromEntries([0, 1, 2].map((q) => [coordKey(cell(q)), {}])), [coordKey(cell(-1))]: { hole: true } },
  }],
})
const standing = (at: { cell: Coord; elevation: number }): SeenScene => ({
  ...SceneStateSchema.parse({ board: { ...board, placements: { a: PlacementSchema.parse(at) } } }),
  characters: { a: someone },
  activeCharacterId: 'a',
})
const lookedAt = (s: SeenScene) => getStoreyView(s, getBoardViewFrom(s), getViewHeight(s, 'auto'), getViewEye(s, 'auto'))

describe('the board looked at from where the active character stands', () => {
  // Broke as: from upstairs, the house's outer wall rising from the ground was
  // judged by its foot, which the floor hides, and drawn as out of sight.
  it('sees the wall standing up through the floor beside them', () => {
    const view = lookedAt(standing({ cell: cell(0), elevation: FLOOR }))
    expect(view.cells.find((c) => c.key === coordKey(cell(3)))?.unseen).toBe(false)
  })

  // Broke as: on the top step of the stair, the floor upstairs beside it was
  // drawn as the ground floor under it.
  it('looks from the storey whose floor is a step above the stair they stand on', () => {
    const s = standing({ cell: cell(-1), elevation: FLOOR - STEP })
    expect(getViewHeight(s, 'auto')).toBe(FLOOR)
    expect(lookedAt(s).cells.find((c) => c.key === coordKey(cell(0)))?.storey).toBe('floor')
  })

  // Broke as: a wall of the ground with a storey over it, out of the sight of
  // the one looking from the ground, was drawn as the floor over it, and the
  // walls of a house went missing from the far side. Kept as walls but left in the dark, they went missing all the same.
  it('draws the ground walls under a storey as the roof over them where they are out of sight', () => {
    const walls = [0, 1, 2, 3]
    const sealed = BoardSchema.parse({
      terrain: Object.fromEntries(walls.map((q) => [coordKey(cell(q)), { blocking: true }])),
      levels: [{ floor: FLOOR, terrain: Object.fromEntries(walls.map((q) => [coordKey(cell(q)), {}])) }],
    })
    const s: SeenScene = {
      ...SceneStateSchema.parse({ board: { ...sealed, placements: { a: PlacementSchema.parse({ cell: cell(-3), elevation: 0 }) } } }),
      characters: { a: someone },
      activeCharacterId: 'a',
    }
    const view = lookedAt(s)
    for (const q of walls) {
      const seen = view.cells.find((c) => c.key === coordKey(cell(q)))
      expect(seen?.terrain === 'wall' || seen?.storey === 'roof').toBe(true)
      expect(seen?.unseen).toBe(false)
    }
  })
})
