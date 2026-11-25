import type { MoveAction, SceneState } from '../scene/types'
import { getWalkableCells, type ReachableCell } from '../scene/rules/move'
import { perParts } from '../perState'
import { getHeight } from '../character/rules/size'
import { isProne } from '../scene/rules/board/ground'
import { withoutPlacements } from '../scene/rules/board/board'
import { getHeldRolls } from '../scene/rules/heldRoll'
import { isCombatStarted } from '../scene/rules/started'

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
const WALKS = 300
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

// `around`: whom the walk goes around.
export function getKeptWalk(state: SceneState, action: MoveAction, around: readonly string[] = []): ReachableCell[] {
  const board = state.board
  if (!board) return getWalkableCells(state, action, around)
  const key = [
    fieldsOf(action),
    READ.map((k) => `${k}=${contentOf(state[k])}`).join(','),
    fieldsOf(board, BOARD_PARTS),
    ...Object.entries(state.characters).map(([id, c]) => `${id}:${sheetOf(c, id === action.actorId)}`),
    around.join(','),
  ].join('|')
  return walked([board.terrain, board.levels, board.pieces], key, () => getWalkableCells(state, action, around))
}

// The same walk for a reader that takes it as an estimate (the bot's step
// maps, threat.ts `getStepMap`): of every sheet only the body is read (its
// footprint, its height and whether it lies prone), and of the one walking
// `walking` besides, what its walking reads (threat.ts `walkingOf`), and the
// scores of its own held tests a move goes on. Of the round, only whether the
// fight has begun (rules/started.ts). A press that moves nobody, and leaves
// every body and the walker's walking as they were, walks nothing again: a
// sheet's injuries, faces and skills, which most presses write, are left out,
// and so are the round's number and the held tests called and not yet thrown.
//
// `alone` walks it with nobody else on the board, so that it reads only the
// walker and the ground: it is walked again only when the walker moves or
// its walking changes, whoever else moves.
const bodyWalked = perParts<ReachableCell[]>(WALKS)

const BODY_READ = ['binds', 'compulsions', 'chase'] as const

// The held tests a move goes on (rules/heldRoll.ts `getMoveHeld`), the
// walker's own, as the scores thrown: one called and not yet thrown reads as
// none (`getHeldRoll`).
const MOVE_HELD = ['swim', 'climb', 'balance'] as const
const heldScores = (state: SceneState, id: string): string => {
  const rolls = getHeldRolls(state, id)
  return MOVE_HELD.map((kind) => contentOf(rolls[kind] ?? null)).join(',')
}
const BOARD_AND_PLACEMENTS: ReadonlySet<string> = new Set([...BOARD_PARTS, 'placements'])

const bodyOf = (state: SceneState, id: string): string => {
  const c = state.characters[id]
  return c ? `${contentOf(c.footprint)}~${getHeight(c)}~${isProne(state, id)}` : '~'
}

export function getKeptBodyWalk(state: SceneState, action: MoveAction, walking: string, alone = false): ReachableCell[] {
  const board = state.board
  if (!board) return getWalkableCells(state, action)
  const id = action.actorId
  const placed = alone ? [`${contentOf(board.placements[id])}`, `${id}:${bodyOf(state, id)}`] : Object.keys(state.characters).map((other) => `${other}:${bodyOf(state, other)}`)
  const key = [
    alone ? 'alone' : 'all',
    fieldsOf(action),
    walking,
    `${isCombatStarted(state)}`,
    BODY_READ.map((k) => `${k}=${contentOf(state[k])}`).join(','),
    heldScores(state, id),
    fieldsOf(board, alone ? BOARD_AND_PLACEMENTS : BOARD_PARTS),
    ...placed,
  ].join('|')
  const walkedOn = alone ? withoutPlacements(state, Object.keys(board.placements).filter((other) => other !== id)) : state
  return bodyWalked([board.terrain, board.levels, board.pieces], key, () => getWalkableCells(walkedOn, action))
}

export function forgetWalks(): void {
  walked.clear()
  bodyWalked.clear()
  contents.clear()
}
