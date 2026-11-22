import type { MoveAction, SceneState } from '../scene/types'
import { getWalkableCells, type ReachableCell } from '../scene/rules/move'
import { perParts } from '../perState'

// The table's walk (`getWalkableCells`), remembered by what it reads rather
// than by the state object. A box reads the fight in many states made from
// one another (a press tried, a cell stood in, a sheet changed) that walk
// alike: the same board, the same people standing in the same places with
// the same sheets. The board's ground, storeys and pieces are kept by
// identity (`perParts`); the rest of the board, every sheet, and of the fight
// only the parts a walk reads (`READ`: whether the fight has started, who
// holds whom, the tests held for the round, the compulsions, a chase) by what
// they hold, each object read once. What anyone but the one walking holds to
// spend is left out, and so is the rest of the fight: the turn, the stack and
// the log, which every press writes anew, a walk reads only through the move
// it is given.
const READ = ['round', 'binds', 'heldTests', 'compulsions', 'chase'] as const
const BOARD_PARTS: ReadonlySet<string> = new Set(['terrain', 'levels', 'pieces'])

// How many walks are kept on one board, and how many contents are told apart
// before they are numbered anew (a content numbered anew is only walked again).
const WALKS = 3000
const CONTENTS = 50000

const numbered = new WeakMap<object, number>()
const contents = new Map<string, number>()
let count = 0

// A value as its content: a primitive as itself, an object by a number its
// content is given the first time it is read.
function contentOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '~'
  let n = numbered.get(value)
  if (n === undefined) {
    const text = JSON.stringify(value)
    n = contents.get(text)
    if (n === undefined) {
      if (contents.size >= CONTENTS) contents.clear()
      n = count++
      contents.set(text, n)
    }
    numbered.set(value, n)
  }
  return `#${n}`
}

const fieldsOf = (o: object, skip?: ReadonlySet<string>): string =>
  Object.entries(o).flatMap(([k, v]) => (skip?.has(k) ? [] : [`${k}=${contentOf(v)}`])).join(',')

// a sheet whole, or, of anyone but the one walking, all but what it holds to spend
const OTHERS_UNREAD: ReadonlySet<string> = new Set(['resources'])
const sheets = new WeakMap<object, string>()
const others = new WeakMap<object, string>()
const sheetOf = (c: object, walking: boolean): string => {
  const kept = walking ? sheets : others
  const known = kept.get(c)
  if (known !== undefined) return known
  const made = fieldsOf(c, walking ? undefined : OTHERS_UNREAD)
  kept.set(c, made)
  return made
}

const walked = perParts<ReachableCell[]>(WALKS)

export function getKeptWalk(state: SceneState, action: MoveAction): ReachableCell[] {
  const board = state.board
  if (!board) return getWalkableCells(state, action)
  const key = [
    fieldsOf(action),
    READ.map((k) => `${k}=${contentOf(state[k])}`).join(','),
    fieldsOf(board, BOARD_PARTS),
    ...Object.entries(state.characters).map(([id, c]) => `${id}:${sheetOf(c, id === action.actorId)}`),
  ].join('|')
  return walked([board.terrain, board.levels, board.pieces], key, () => getWalkableCells(state, action))
}
