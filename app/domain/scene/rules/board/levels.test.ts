import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, type Board, type Coord, type SceneState } from '../../types'
import { makeCampaignCharacter } from '../../../factories'
import { coordKey } from './geometry'
import { firesAcross, getCoverAcross, hasLineOfSight, seesAcross, type Eyes } from './board'

// combat.tex "Cover": a space containing a blocking object stops what passes
// through it; "cover blocks vision unless it is transparent". A house is drawn
// as a row of cells along r = 0: the room at q = 0, the wall at q = 1 and open
// ground beyond it. The ground floor's wall is opaque, the second floor's is
// either a pane of glass or opaque, and the second floor is a floor over the
// room and the wall.
const at = (q: number): Coord => ({ q, r: 0 })
const key = (q: number) => coordKey(at(q))
const WALL = { blocking: true }
const GLASS = { blocking: true, transparent: true }

const SECOND_FLOOR = 3
const STOREY = 3
const EYE = 1

const house = (windowCell: Record<string, unknown>): Board =>
  BoardSchema.parse({
    terrain: { [key(1)]: WALL },
    levels: [{ floor: SECOND_FLOOR, height: STOREY, terrain: { [key(0)]: {}, [key(1)]: windowCell } }],
  })

// From the second floor's room to the height `to`.
const fromUpstairs = (to: number): Eyes => ({ from: SECOND_FLOOR + EYE, to })

describe('a line is met at the height it crosses', () => {
  const withWindow = house(GLASS)
  const withoutWindow = house(WALL)

  it('sees out of the second floor through a pane there, and not through a wall there', () => {
    expect(seesAcross(withWindow, [at(0)], [at(4)], fromUpstairs(EYE))).toBe(true)
    expect(seesAcross(withoutWindow, [at(0)], [at(4)], fromUpstairs(EYE))).toBe(false)
  })

  it('stops what is shot through glass, which is seen through', () => {
    expect(firesAcross(withWindow, [at(0)], [at(4)], fromUpstairs(EYE))).toBe(false)
  })

  it('is stopped by the wall below the window when the line goes down through it', () => {
    expect(seesAcross(withWindow, [at(0)], [at(2)], fromUpstairs(0))).toBe(false)
  })

  it('goes over a wall that is lower than the line', () => {
    const over = SECOND_FLOOR + STOREY + EYE
    expect(seesAcross(withoutWindow, [at(0)], [at(4)], { from: over, to: over })).toBe(true)
  })
})

describe('the floor of a storey is crossed only where it is a hole', () => {
  const upper = (hole: boolean) =>
    BoardSchema.parse({ levels: [{ floor: SECOND_FLOOR, height: STOREY, terrain: { [key(0)]: {}, [key(1)]: { hole }, [key(2)]: {} } }] })
  const upTheStairs: Eyes = { from: EYE, to: SECOND_FLOOR + EYE }

  it('stops a line from the room below to the room above', () => {
    expect(seesAcross(upper(false), [at(0)], [at(2)], upTheStairs)).toBe(false)
    expect(getCoverAcross(upper(false), [at(0)], [at(2)], upTheStairs)).toEqual({ kind: 'total' })
  })

  it('lets it through a hole', () => {
    expect(seesAcross(upper(true), [at(0)], [at(2)], upTheStairs)).toBe(true)
    expect(getCoverAcross(upper(true), [at(0)], [at(2)], upTheStairs)).toBeNull()
  })

  it('does not stop a line that stays on one side of it', () => {
    expect(seesAcross(upper(false), [at(0)], [at(2)], { from: SECOND_FLOOR + EYE, to: SECOND_FLOOR + EYE })).toBe(true)
  })
})

describe('characters see along their own eyes', () => {
  function combat(board: Board, aboveElevation: number): SceneState {
    const placement = (q: number, elevation: number) => ({ cell: at(q), orientation: 0 as const, elevation, depth: 0, focus: null, climb: null })
    return {
      ...SceneStateSchema.parse({ board: { ...board, placements: { above: placement(0, aboveElevation), outside: placement(4, 0) } } }),
      characters: Object.fromEntries(['above', 'outside'].map((id) => [id, { ...makeCampaignCharacter({ name: id }), id }])),
    }
  }

  it('sees out of the window from the second floor, and is seen from outside', () => {
    const s = combat(house(GLASS), SECOND_FLOOR)
    expect(hasLineOfSight(s, 'above', 'outside')).toBe(true)
    expect(hasLineOfSight(s, 'outside', 'above')).toBe(true)
  })

  it('does not see out of the same cell on the ground floor, where the wall is opaque', () => {
    expect(hasLineOfSight(combat(house(GLASS), 0), 'above', 'outside')).toBe(false)
  })
})
