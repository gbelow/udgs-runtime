import type { Character, MoveKind } from '../../types'
import type { CombatState, Coord, MoveAction, Placement, StrikeAction, Trample } from '../types'
import { getForce } from '../../character/rules/skills'
import { getAfflictions } from '../../character/rules/afflictions'
import { DIRECTIONS, add, directionTo, sameCell } from '../geometry'
import { getFootprint, withPlacements } from './board'
import { canStandAt, getMoveOrigin, getMoveWaypoint, getMovementSpeed } from './move'
import { getReactionsTo } from './action'

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
function getTrampleForce(c: Character, movement: MoveKind | null): number {
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
// footprint can come to rest; `to` stays null where it cannot, and a move
// that would push someone there is not a legal path (the table's ruling:
// pushing against a blocked cell is not possible).
function outcome(state: CombatState, id: string, at: number, result: Trample['result'], from: Placement, heading: number): Trample {
  if (result !== 'pushed') return { id, at, result, to: null }
  const to = { ...from, cell: add(from.cell, DIRECTIONS[heading]) }
  return { id, at, result, to: canStandAt(state, id, to) ? to : null }
}

// The move's path as walked against everyone standing in it who did not
// evade it ("Evade: ... it always works automatically unless trample is a
// directed attack"), step by step: each step whose footprint comes into one
// is a comparison, at the mover's Force (and speed) against theirs. One
// pushed further along the heading is met again on the next step into them;
// one knocked down is prone, so passed over freely; the first comparison the
// mover loses stops them a space short of it — `stop`, the steps walked.
// `blocked`: a push on the way had nowhere to put its opponent.
export function getMoveTramples(state: CombatState, action: MoveAction, path: Coord[]): { trampled: Trample[]; stop: number | null; blocked: boolean } {
  const mover = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!mover || !from || !board) return { trampled: [], stop: null, blocked: false }
  const evaded = new Set(getReactionsTo(state, action.id).filter((a) => a.kind === 'evade').map((a) => a.actorId))
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
      const now = withPlacements(state, where)
      const result = outcome(now, id, i + 1, compare(runner, getForce(other)), where[id], heading)
      trampled.push(result)
      if (result.result === 'stopped') return { trampled, stop: i, blocked: false }
      if (result.result === 'pushed' && !result.to) return { trampled, stop: i, blocked: true }
      if (result.to) where[id] = result.to
      else down.add(id)
    }
    cursor = cell
  }
  return { trampled, stop: null, blocked: false }
}

// The trample a blow on a mover sets off — a braced one, or a catch: the
// mover it met, at their Force and speed, against the striker — "If a
// strike started this action, targeting the head increases attacker's force
// by 3"; combat.tex "Catch": the catcher "add[s] their own running speed to
// defend the trample". The striker is pushed back along the mover's heading
// at the step the blow came on.
export function getBlowTrample(state: CombatState, strike: StrikeAction, move: MoveAction, at: number): Trample | null {
  const mover = state.characters[move.actorId]
  const bracer = state.characters[strike.actorId]
  const placed = state.board?.placements[strike.actorId]
  // a catch meets the runner on the step that brought them in reach, the
  // one before the one it is fought ahead of
  const step = strike.catch ? at - 1 : at
  const before = step <= 1 ? getMoveOrigin(state, move) : getMoveWaypoint(state, move, step - 1)
  const after = getMoveWaypoint(state, move, step)
  if (!mover || !bracer || !placed || !before || !after) return null
  const runner = getTrampleForce(mover, move.movement)
  const opponent = getForce(bracer) + (strike.location === 'head' ? 3 : 0) + (strike.catch ? getMovementSpeed(bracer, 'run') : 0)
  return outcome(state, bracer.id, at, compare(runner, opponent), placed, directionTo(before.cell, after.cell))
}
