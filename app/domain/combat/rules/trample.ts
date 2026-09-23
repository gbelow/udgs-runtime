import type { Character, MoveKind } from '../../types'
import type { CombatState, Coord, MoveAction, Placement, StrikeAction, Trample } from '../types'
import { getForce } from '../../character/rules/skills'
import { getAfflictions } from '../../character/rules/afflictions'
import { DIRECTIONS, add, directionTo, sameCell } from '../geometry'
import { getFootprint } from './board'
import { canStandAt, getMoveOrigin, getMoveWaypoint, getMovementSpeed } from './move'

// combat.tex "Trample": "Happens when two characters hit each other at
// speed. This is a Force vs Force comparison." Two ways into one here: a
// move whose path comes into someone standing (combat.tex "Movement" —
// "trample"), and a braced blow on a mover coming at the bracer (combat.tex
// "Braced Attack": "The additional damage effect also triggers a trample").

// "Trampling a prone character is an automatic success and allows free
// passage" — nobody to compare against.
export function isTrampleable(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !getAfflictions(c).includes('prone')
}

// "Whoever is running or jumping gets a bonus equal to their running or
// jumping speed to this."
export function getTrampleForce(c: Character, movement: MoveKind | null): number {
  const speed = movement === 'run' || movement === 'jump' ? getMovementSpeed(c, movement) : 0
  return getForce(c) + speed
}

// "If the runner's Force is higher, the opponent moves back one space and is
// stunned. If Force is 5 points higher or more, the opponent is stunned and
// prone. ... If the defender's force is equal or higher, the runner is
// stopped and stunned."
function compare(runner: number, opponent: number): Trample['result'] {
  if (opponent >= runner) return 'stopped'
  return runner - opponent >= 5 ? 'knocked' : 'pushed'
}

// The opponent moved back a space along the runner's heading, where their
// footprint can come to rest; with nowhere to go back to they fall where
// they stand instead (the table's ruling).
function outcome(state: CombatState, id: string, at: number, result: Trample['result'], from: Placement, heading: number): Trample {
  if (result !== 'pushed') return { id, at, result, to: null }
  const to = { ...from, cell: add(from.cell, DIRECTIONS[heading]) }
  return canStandAt(state, id, to) ? { id, at, result, to } : { id, at, result: 'knocked', to: null }
}

// The move's path as walked against everyone standing in it who did not
// evade it ("Evade: ... it always works automatically unless trample is a
// directed attack"), step by step: each step whose footprint comes into one
// is a comparison, at the mover's Force (and speed) against theirs. One
// pushed further along the heading is met again on the next step into them;
// one knocked down is prone, so passed over freely; the first comparison the
// mover loses stops them a space short of it — `stop`, the steps walked.
export function getMoveTramples(state: CombatState, action: MoveAction, path: Coord[]): { trampled: Trample[]; stop: number | null } {
  const mover = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!mover || !from || !board) return { trampled: [], stop: null }
  const evaded = new Set(state.actions.filter((a) => a.reactionTo === action.id && a.kind === 'evade').map((a) => a.actorId))
  const standing = Object.keys(state.characters).filter((id) => id !== action.actorId && !evaded.has(id) && isTrampleable(state, id))

  const runner = getTrampleForce(mover, action.movement)
  const where: Record<string, Placement> = {}
  for (const id of standing) if (board.placements[id]) where[id] = board.placements[id]
  const down = new Set<string>()
  const trampled: Trample[] = []
  let cursor = from.cell
  for (const [i, cell] of path.entries()) {
    const heading = directionTo(cursor, cell)
    const footprint = getFootprint(mover, { ...from, cell })
    for (const id of Object.keys(where)) {
      const other = state.characters[id]
      if (!other || down.has(id)) continue
      const theirs = getFootprint(other, where[id])
      if (!footprint.some((f) => theirs.some((t) => sameCell(f, t)))) continue
      const now = { ...state, board: { ...board, placements: { ...board.placements, ...where } } }
      const result = outcome(now, id, i + 1, compare(runner, getForce(other)), where[id], heading)
      trampled.push(result)
      if (result.result === 'stopped') return { trampled, stop: i }
      if (result.to) where[id] = result.to
      else down.add(id)
    }
    cursor = cell
  }
  return { trampled, stop: null }
}

// The braced blow's trample: the mover it met, at their Force and speed,
// against the bracer — "If a strike started this action, targeting the head
// or legs increases attacker's force by 3". The bracer is pushed back along
// the mover's heading at the step the blow came on.
export function getBracedTrample(state: CombatState, strike: StrikeAction, move: MoveAction, at: number): Trample | null {
  const mover = state.characters[move.actorId]
  const bracer = state.characters[strike.actorId]
  const placed = state.board?.placements[strike.actorId]
  const before = at <= 1 ? getMoveOrigin(state, move) : getMoveWaypoint(state, move, at - 1)
  const after = getMoveWaypoint(state, move, at)
  if (!mover || !bracer || !placed || !before || !after) return null
  const runner = getTrampleForce(mover, move.movement)
  const opponent = getForce(bracer) + (strike.location === 'head' || strike.location === 'leg' ? 3 : 0)
  return outcome(state, bracer.id, at, compare(runner, opponent), placed, directionTo(before.cell, after.cell))
}
