import { describe, it, expect } from 'vitest'
import { BoardSchema, PlacementSchema, SceneStateSchema, type Board, type Coord, type SceneState } from '../../types'
import type { MoveKind } from '../../../types'
import { FALL } from '../../../tables'
import { makeAction } from '../../factories'
import { makeCampaignCharacter } from '../../../factories'
import { coordKey } from './geometry'
import { firesAcross, getCoverAcross, getDistanceBetween, hasLineOfSight, seesAcross, type Eyes } from './board'
import { canStandAt } from './ground'
import { getMoveFall } from './cliff'
import { getMoveDestination } from './waypoint'
import { isPathLegal } from '../move'

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

// combat.tex "Choosing Fall DL": ground a metre or more above or below is a
// cliff, which a walk does not step over. A storey's floor is ground to whoever
// stands on it, and a stair is ground under a stairwell rising less than a
// cliff a step. A room upstairs runs along r = 0 from q = 0 to q = 2, over a
// wall on the ground at q = 2; the stair climbs to it from q = -4, and a
// stairwell at (0, 1) has nothing under it but the ground.
describe('standing and walking on a storey', () => {
  const STEP = FALL.minHeight * 0.75
  const FLOOR = 4 * STEP
  const cell = (q: number, r = 0): Coord => ({ q, r })
  const stair = [3, 2, 1].map((n, i) => [coordKey(cell(-n)), { elevation: (i + 1) * STEP }] as const)
  const board = BoardSchema.parse({
    terrain: { [coordKey(cell(2))]: WALL, ...Object.fromEntries(stair) },
    levels: [{
      floor: FLOOR,
      terrain: {
        ...Object.fromEntries([0, 1, 2].map((q) => [coordKey(cell(q)), {}])),
        ...Object.fromEntries(stair.map(([k]) => [k, { hole: true }])),
        [coordKey(cell(0, 1))]: { hole: true },
      },
    }],
  })
  const scene = (placed: Record<string, { cell: Coord; elevation: number }>): SceneState => ({
    ...SceneStateSchema.parse({ board: { ...board, placements: Object.fromEntries(Object.entries(placed).map(([id, p]) => [id, PlacementSchema.parse(p)])) } }),
    characters: Object.fromEntries(Object.keys(placed).map((id) => [id, { ...makeCampaignCharacter({ name: id }), id }])),
  })
  const walk = (path: Coord[], movement: MoveKind = 'basic') => makeAction('move', { id: 'walk', actorId: 'a', movement, path })
  const upstairs = scene({ a: { cell: cell(0), elevation: FLOOR } })

  it('keeps a walk to the storey it is on, over a wall on the ground below', () => {
    const along = walk([cell(1), cell(2)])
    expect(isPathLegal(upstairs, along)).toBe(true)
    expect(getMoveDestination(upstairs, along, along.path)?.elevation).toBe(FLOOR)
  })

  it('walks the ground under the storey, where the wall on the ground stands in the way', () => {
    const below = (q: number) => scene({ a: { cell: cell(q, -1), elevation: 0 } })
    const under = walk([cell(0)])
    expect(isPathLegal(below(0), under)).toBe(true)
    expect(getMoveDestination(below(0), under, under.path)?.elevation).toBe(0)
    expect(isPathLegal(below(2), walk([cell(2)]))).toBe(false)
  })

  it('does not walk off the storey into the open air or down the stairwell', () => {
    expect(isPathLegal(upstairs, walk([cell(1), cell(2), cell(3)]))).toBe(false)
    expect(isPathLegal(upstairs, walk([cell(0, 1)]))).toBe(false)
  })

  it('walks up the stair onto the storey', () => {
    const up = walk([cell(-3), cell(-2), cell(-1), cell(0), cell(1)])
    const below = scene({ a: { cell: cell(-4), elevation: 0 } })
    expect(isPathLegal(below, up)).toBe(true)
    expect(getMoveDestination(below, up, up.path)?.elevation).toBe(FLOOR)
  })

  it('falls the height of the storey jumping down the stairwell', () => {
    const down = walk([cell(0, 1)], 'jump')
    expect(getMoveFall(upstairs, down, down.path, false)?.height).toBe(FLOOR)
  })

  it('stands two characters in one cell a storey apart, as far apart as the storey is high', () => {
    const stacked = scene({ a: { cell: cell(0), elevation: FLOOR }, b: { cell: cell(0), elevation: 0 } })
    expect(canStandAt(stacked, 'a', stacked.board!.placements.a)).toBe(true)
    expect(canStandAt(stacked, 'b', stacked.board!.placements.b)).toBe(true)
    expect(getDistanceBetween(stacked, 'a', 'b')).toBe(FLOOR)
  })
})
