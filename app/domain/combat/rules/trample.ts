import type { Character } from '../../types'
import type { CombatState, Coord, MoveAction, StrikeAction, Trample } from '../types'
import { getForce } from '../../character/rules/skills'
import { hasAffliction } from '../../character/rules/afflictions'
import { getMovementSpeed } from '../../character/rules/movement'
import { sameCell } from '../geometry'
import { getFootprint } from './board'
import { getMoveOrigin } from './waypoint'
import { getDrawnOpportunityAttacks, getReactionsTo } from './log'
import { getMoveBlockCells } from './move'

// combat.tex "Trample": "Happens when a character moves through a space
// occupied by another character." Two ways into one here: a move whose path
// comes into someone standing, and a braced blow or a catch on a mover
// (combat.tex "Braced Attack": a hit "trigger[s] a trample"; "Catch").

// combat.tex "Crash": "The target can spend 2AP+1STA to get +3 in this
// comparison (automatic from braced attack reaction)"; "A hit to the head
// adds +3 to the crash"; "Catch": the catcher "receive[s] the +3 to the
// crash".
const BRACED = 3
const HEAD = 3

// "Is prone: free passage" — nobody to compare against.
export function isTrampleable(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !hasAffliction(c, 'prone')
}

// "Whoever is running adds their movement speed to their Force" — and a
// character is running only once the first 2 AP of the run are behind them
// (combat.tex "running": "The first 2 AP worth of running must be
// uninterrupted, otherwise, running cannot be started"). `at` is the path
// step the crash comes on.
function getMoverForce(c: Character, move: MoveAction, at: number): number {
  const running = move.movement === 'run' && at > getMoveBlockCells(c, 'run', 2)
  return getForce(c) + (running ? getMovementSpeed(c, 'run') : 0)
}

// "On force differences lower than 5, both are stunned and the higher force
// gets to either block passage or pass through. A draw blocks passage. On
// greater differences, the winner does not get stunned and the loser falls
// prone if they are the target."
function crash(moverId: string, targetId: string, at: number, mover: number, target: number): Trample {
  const diff = mover - target
  const result = diff > 0 ? 'passed' : 'blocked'
  if (Math.abs(diff) < 5) return { id: targetId, at, diff, result, stunned: [moverId, targetId], prone: false }
  return { id: targetId, at, diff, result, stunned: [diff > 0 ? targetId : moverId], prone: diff > 0 }
}

// The move's path as walked against everyone standing in it, step by step:
// the first step whose footprint comes into one is their crash, at the
// mover's Force against theirs. Passed, the mover goes on through them;
// blocked, the mover stops a space short of them — `stop`, the steps
// walked. Left out are whoever "Evades: ... free passage", whoever is prone,
// and a bracer or catcher whose blow on this move was its crash already.
export function getMoveTramples(state: CombatState, action: MoveAction, path: Coord[]): { trampled: Trample[]; stop: number | null } {
  const mover = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!mover || !from || !board) return { trampled: [], stop: null }
  const reactions = getReactionsTo(state, action.id)
  const evaded = new Set(reactions.filter((a) => a.kind === 'evade').map((a) => a.actorId))
  const braced = new Set(reactions.filter((a) => a.kind === 'brace').map((a) => a.actorId))
  const struck = new Set(getDrawnOpportunityAttacks(state, action).flatMap(({ spawned }) => (spawned?.kind === 'strike' && spawned.trample ? [spawned.actorId] : [])))
  const standing = Object.keys(state.characters).filter((id) => id !== action.actorId && !evaded.has(id) && !struck.has(id) && isTrampleable(state, id) && board.placements[id])

  const met = new Set<string>()
  const trampled: Trample[] = []
  for (const [i, cell] of path.entries()) {
    const footprint = getFootprint(mover, { ...from, cell })
    for (const id of standing) {
      const other = state.characters[id]
      if (!other || met.has(id)) continue
      const theirs = getFootprint(other, board.placements[id])
      if (!footprint.some((f) => theirs.some((t) => sameCell(f, t)))) continue
      met.add(id)
      const result = crash(mover.id, id, i + 1, getMoverForce(mover, action, i + 1), getForce(other) + (braced.has(id) ? BRACED : 0))
      trampled.push(result)
      if (result.result === 'blocked') return { trampled, stop: i }
    }
  }
  return { trampled, stop: null }
}

// The crash a blow on a mover sets off — a braced one, or a catch: the mover
// it met, at their Force (and speed), against the striker, braced either way
// and more so for a hit to the head.
export function getBlowTrample(state: CombatState, strike: StrikeAction, move: MoveAction, at: number): Trample | null {
  const mover = state.characters[move.actorId]
  const striker = state.characters[strike.actorId]
  if (!mover || !striker) return null
  const target = getForce(striker) + BRACED + (strike.location === 'head' ? HEAD : 0)
  return crash(mover.id, striker.id, at, getMoverForce(mover, move, at), target)
}
