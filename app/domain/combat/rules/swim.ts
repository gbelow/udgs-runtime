import type { Character, Degree } from '../../types'
import type { Board, CombatState, Coord, MoveAction, SwimTestAction } from '../types'
import { SWIM_ONE_HAND_PENALTY } from '../../tables'
import { getSwimTerms } from '../../character/rules/skills'
import type { Term } from '../../character/rules/terms'
import { getFreeHoldingHands } from '../../item/rules/hands'
import { coordKey } from '../geometry'
import { getFootprint } from './board'
import { getHeldRoll } from './heldRoll'
import { getDegree } from './test'
import { getMoveOrigin, touchesGround } from './waypoint'

// combat.tex "Swimming": the body of water a footprint stands in, read off the
// cells of it that are liquid. The surface is the cells' elevation and the
// floor that less their depth; a footprint takes the worst of its cells.
export type Water = { surface: number; floor: number; DL: number }

export function readWater(board: Board, footprint: Coord[]): Water | null {
  const cells = footprint.flatMap((cell) => {
    const terrain = board.terrain[coordKey(cell)]
    return terrain?.liquid ? [terrain] : []
  })
  if (cells.length === 0) return null
  return {
    surface: Math.max(...cells.map((t) => t.elevation)),
    floor: Math.max(...cells.map((t) => t.elevation - t.depth)),
    DL: Math.max(...cells.map((t) => t.DL)),
  }
}

export function getWaterOf(state: CombatState, id: string): Water | null {
  const c = state.characters[id]
  const placement = state.board?.placements[id]
  return c && placement && state.board ? readWater(state.board, getFootprint(c, placement)) : null
}

function maxDepth(water: Water): number {
  return water.surface - water.floor
}

// How deep the water lets a swimmer be: no deeper than the floor.
export function clampDepth(water: Water | null, depth: number): number {
  return water ? Math.max(0, Math.min(depth, maxDepth(water))) : 0
}

// Metres below the surface the character swims at; none out of the water.
export function getDepth(state: CombatState, id: string): number {
  return clampDepth(getWaterOf(state, id), state.board?.placements[id]?.depth ?? 0)
}

// combat.tex "Swimming": "Characters attempting to swim with one hand receive
// a -3 penalty on the test." A hand a wound has put out of use is no hand.
function swimsWithOneHand(c: Character): boolean {
  const hands = c.body.filter((part) => part.grip).length
  return hands > 0 && getFreeHoldingHands(c).length < Math.min(2, hands)
}

export function getSwimTestTerms(c: Character): Term[] {
  return [...getSwimTerms(c), ...(swimsWithOneHand(c) ? [{ label: 'one hand', value: SWIM_ONE_HAND_PENALTY }] : [])]
}

// The water each cell of the move's path is in, null where it is dry or, for a
// jump, only passed over.
export function getSwimWaters(state: CombatState, action: MoveAction): (Water | null)[] {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!c || !from || !board) return []
  return action.path.map((cell, i) => (touchesGround(action.movement, i === action.path.length - 1) ? readWater(board, getFootprint(c, { ...from, cell })) : null))
}

function isSwim(action: MoveAction): boolean {
  return action.movement === 'swim'
}

// combat.tex "Swimming": "When entering the water ... make a swimming check
// against the DL of the body of water": the test of the swimmer a move left in
// it, in the water they are in.
export function getSwimTestRootTerms(state: CombatState, action: SwimTestAction): { skill: Term[]; DL: Term[] } | null {
  const c = state.characters[action.actorId]
  return c ? { skill: getSwimTestTerms(c), DL: [{ label: 'water', value: getWaterOf(state, action.actorId)?.DL ?? 0 }] } : null
}

// The score the move is swum on: the round's test.
export function getSwimScore(state: CombatState, action: MoveAction): number | null {
  return getHeldRoll(state, action.actorId, 'swim')?.score ?? null
}

// How well each of the first `cells` cells of the path is swum: the held
// score against that cell's water. Until there is a score, every cell is
// taken as swum perfectly.
// The last water the path reaches, or the water the swimmer is in.
function getLastWater(state: CombatState, action: MoveAction): Water | null {
  return getSwimWaters(state, action).findLast((w) => w !== null) ?? getWaterOf(state, action.actorId)
}

// The metres of the dive are swum in the last water the path reaches.
export function getSwimDegrees(state: CombatState, action: MoveAction, cells: number): Degree[] {
  const score = getSwimScore(state, action)
  const walked = getSwimWaters(state, action).slice(0, cells)
  const dived = Array<Water | null>(Math.abs(action.dive)).fill(walked.findLast((w) => w !== null) ?? getWaterOf(state, action.actorId))
  return [...walked, ...dived].map((water) => (score === null || water === null ? 'hit' : getDegree(score, water.DL)))
}

// combat.tex "Movement": swimming "also applies the prone condition", and as
// with a climb's top (combat.tex "Climbing") the one who comes out of the water
// onto land must spend AP to stand up: a swim whose walked path ends dry leaves
// its swimmer prone.
export function getSwimFinish(state: CombatState, action: MoveAction, walked: Coord[]): 'prone' | null {
  return isSwim(action) && walked.length > 0 && getSwimWaters(state, action)[walked.length - 1] === null ? 'prone' : null
}

// The depth a swim move leaves its swimmer at: where the dive takes them once
// the move has gone to its end, kept between the surface and the floor of the
// water they end in.
export function getDepthAfter(state: CombatState, action: MoveAction, water: Water | null, completed: boolean): number {
  return clampDepth(water, getDepth(state, action.actorId) + (completed ? action.dive : 0))
}

// The dive a metre nearer the surface (`up`) or the floor (`down`) than the
// move's, or null where the water in which the move ends allows no more.
// Null for a move that is not a swim.
export function getDiveSteps(state: CombatState, action: MoveAction): { up: number | null; down: number | null } | null {
  if (!isSwim(action)) return null
  const water = getLastWater(state, action)
  const depth = getDepth(state, action.actorId)
  const allowed = (dive: number) => water !== null && depth + dive >= 0 && depth + dive <= maxDepth(water)
  return { up: allowed(action.dive - 1) ? action.dive - 1 : null, down: allowed(action.dive + 1) ? action.dive + 1 : null }
}

// Whether the dive keeps the swimmer between the surface and the floor of the
// water the move ends in.
export function isDiveLegal(state: CombatState, action: MoveAction, water: Water | null): boolean {
  if (action.dive === 0) return true
  if (!isSwim(action) || water === null || !Number.isInteger(action.dive)) return false
  const depth = getDepth(state, action.actorId) + action.dive
  return depth >= 0 && depth <= maxDepth(water)
}
