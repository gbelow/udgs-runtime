import type { Character, MoveKind } from '../../types'
import type { ActionRoll, CombatState, Coord, Degree, MoveAction, MoveFall } from '../types'
import { CLIMB_HEIGHT, FALL } from '../../tables'
import { hasGrant } from '../../character/rules/abilities'
import { getRM } from '../../character/rules/size'
import type { RollMode } from '../dice'
import { coordKey } from '../geometry'
import { getDegree } from './test'
import { isCampaignCharacter } from '../../utils'
import { readGround } from './ground'
import { getMoveOrigin } from './waypoint'

// Where the ground drops or rises too far to be walked: the cliffs of a move,
// the climb that crosses one, and the fall that follows a jump down or a
// climb that failed.

// combat.tex "Choosing Fall DL": the least a fall is — a metre — is the least
// of a cliff, up or down.
export function isCliff(from: number, to: number): boolean {
  return Math.abs(to - from) >= FALL.minHeight
}

// Whether a kind of movement may take a step from ground at one height to
// ground at another. A walk crosses no cliff; a jump goes up as far as it
// clears (`getJumpCeiling`) and comes down as a fall; a climb is the way over;
// a swimmer's water has its own surface. combat.tex "Climbing": a climb is
// over cliffs alone; the ground between them is not climbed, and the next
// cliff starts a climb of its own.
export function canStepOver(kind: MoveKind, from: number, to: number): boolean {
  if (kind === 'climb') return isCliff(from, to)
  return kind === 'swim' || kind === 'jump' || !isCliff(from, to)
}

// The height of the ground the mover sets out from and then of each cell of
// the path; null where there is no board.
export function getPathElevations(state: CombatState, action: MoveAction, path: Coord[]): number[] | null {
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  return from && ground ? [ground.elevation(from.cell), ...path.map((cell) => ground.elevation(cell))] : null
}

function hasCliff(elevations: number[]): boolean {
  return elevations.some((height, i) => i > 0 && isCliff(elevations[i - 1], height))
}

// Whether the path crosses a cliff, which a climb must.
export function crossesCliff(state: CombatState, action: MoveAction, path: Coord[]): boolean {
  const elevations = getPathElevations(state, action, path)
  return elevations !== null && hasCliff(elevations)
}

// combat.tex "Climbing": "Any character starts a climb at their own height"
// (creating.tex "Reach Multiplier (RM)"); abilities.tex "Jumper II": the jump
// spent to start the climb gains "+1m xRM to the starting distance".
export function getClimbStart(c: Character, leap: boolean): number {
  const RM = getRM(c)
  return CLIMB_HEIGHT * RM + (leap && hasGrant(c, 'climbLeap') ? RM : 0)
}

// The metres of cliff a climb goes over; a climb is made of nothing else.
function getClimbRise(state: CombatState, action: MoveAction, path: Coord[]): number | null {
  const elevations = getPathElevations(state, action, path)
  return elevations && path.reduce((total, _, i) => total + Math.abs(elevations[i + 1] - elevations[i]), 0)
}

// How much of the path there is to climb: what is left of the cliffs' height
// after the climber's start.
export function getClimbCells(state: CombatState, action: MoveAction, path: Coord[]): number {
  const c = state.characters[action.actorId]
  const rise = getClimbRise(state, action, path)
  return c && rise !== null ? Math.max(0, rise - getClimbStart(c, action.leap)) : path.length
}

// combat.tex "Climbing": "Any climb with height equal or lower than the
// character's height can be done by just standing up in the new location" —
// one step over a cliff no higher than the climber starts at has nothing left
// to climb.
export function isTrivialClimb(state: CombatState, action: MoveAction, path: Coord[] = action.path): boolean {
  const c = state.characters[action.actorId]
  const rise = action.movement === 'climb' && path.length === 1 ? getClimbRise(state, action, path) : null
  return !!c && rise !== null && rise > 0 && rise <= getClimbStart(c, action.leap)
}

// combat.tex "Climbing": "To determine the difficulty of climbing, consider
// ... the quality of the grips and the distance between holds" — the board
// paints the DL of each face (`climbDL`) and the hardest face the climb takes
// hold of counts; a face with no DL has nothing to hold. Distance adds
// nothing: the STA every block costs already pays for it.
export function getClimbDL(state: CombatState, action: MoveAction, path: Coord[] = action.path): number | null {
  const elevations = getPathElevations(state, action, path)
  const origin = getMoveOrigin(state, action)
  const board = state.board
  if (!elevations || !origin || !board) return null
  const faces = path.map((cell, i) => (elevations[i] >= elevations[i + 1] ? (i === 0 ? origin.cell : path[i - 1]) : cell))
  const DLs = faces.map((cell) => board.terrain[coordKey(cell)]?.climbDL ?? null)
  return DLs.length === 0 || DLs.includes(null) ? null : Math.max(...(DLs as number[]))
}

// combat.tex "Climbing": whether the path is a climb that can be made: over
// cliffs alone, each with something to hold, unless it is no taller than the
// climber.
export function isClimbable(state: CombatState, action: MoveAction, path: Coord[]): boolean {
  return crossesCliff(state, action, path) && (getClimbDL(state, action, path) !== null || isTrivialClimb(state, action, path))
}

// abilities.tex "Climber": safe climbing from the first level, risky from the
// second "during a movement surge"; play.tex "Safe and risky tests": "only ...
// when indicated in the skill or ability".
export function getClimbModes(c: Character): RollMode[] {
  const surging = isCampaignCharacter(c) && c.usedSurge === 'movement'
  return ['normal', ...(hasGrant(c, 'safeClimb') ? ['safe' as const] : []), ...(hasGrant(c, 'riskyClimb') && surging ? ['risky' as const] : [])]
}

type ClimbTest = { roll: ActionRoll; mode: RollMode }

// combat.tex "Climbing": "The same test result is saved for the entire
// round" — the one the climber's latest climb earlier this round was rolled
// with, and the way it was rolled. Read off what landed before the move,
// whose own die, if it has one, is not one of them.
function getClimbMemory(state: CombatState, action: MoveAction): ClimbTest | null {
  const at = state.record.findIndex((a) => a.id === action.id)
  const before = at === -1 ? state.record : state.record.slice(0, at)
  for (const a of [...before].reverse()) {
    if (a.kind === 'move' && a.actorId === action.actorId && a.round === action.round && a.test === 'climb' && a.roll) return { roll: a.roll, mode: a.mode }
  }
  return null
}

// Whether the climb is closed by a die of its own: the climber has not tested
// this round, or the move carries the test it was rolled with.
export function needsClimbTest(state: CombatState, action: MoveAction): boolean {
  return !isTrivialClimb(state, action) && (action.roll !== null || getClimbMemory(state, action) === null)
}

function getClimbTest(state: CombatState, action: MoveAction): ClimbTest | null {
  return action.roll ? { roll: action.roll, mode: action.mode } : getClimbMemory(state, action)
}

// What the climb's test came to against this climb's DL; a climb given up is
// a failure.
export function getClimbDegree(state: CombatState, action: MoveAction): Degree | null {
  if (action.gaveUp) return 'miss'
  if (isTrivialClimb(state, action)) return null
  const test = getClimbTest(state, action)
  const DL = getClimbDL(state, action)
  return test && DL !== null ? getDegree(test.roll.score, DL) : null
}

// abilities.tex "Climber II": whether the test that stands for the climb was
// made in a risky manner.
export function isClimbRisky(state: CombatState, action: MoveAction): boolean {
  return (getClimbTest(state, action)?.mode ?? action.mode) === 'risky'
}

// combat.tex "Climbing": "On a failure, the character simply falls" — from
// the test as made, or from the one an interrupting attack had the climber
// make (`redoFell`).
export function hasClimbFailed(state: CombatState, action: MoveAction, redoFell: boolean): boolean {
  return getClimbDegree(state, action) === 'miss' || redoFell
}

// combat.tex "Climbing": "On a failure, the character simply falls from the
// surface" — the table's ruling is from the highest point the climb reached,
// less the height the climber started it at, to the lower of where it began
// and where it was bound; null where that is no fall at all.
function getClimbFall(state: CombatState, action: MoveAction, path: Coord[]): MoveFall | null {
  const elevations = getPathElevations(state, action, path)
  const origin = getMoveOrigin(state, action)
  if (!elevations || !origin) return null
  const last = elevations.length - 1
  const landsAtEnd = elevations[last] < elevations[0]
  const c = state.characters[action.actorId]
  const height = Math.max(0, Math.max(...elevations) - elevations[landsAtEnd ? last : 0] - (c ? getClimbStart(c, action.leap) : 0))
  return height >= FALL.minHeight ? { height, to: landsAtEnd ? path[path.length - 1] : origin.cell } : null
}

// combat.tex "Fall skill test": a jump that comes down on lower ground lands
// from the height it came down.
function getJumpFall(state: CombatState, action: MoveAction, path: Coord[]): MoveFall | null {
  const elevations = getPathElevations(state, action, path)
  if (!elevations || path.length === 0) return null
  const height = elevations[0] - elevations[elevations.length - 1]
  return height >= FALL.minHeight ? { height, to: null } : null
}

// combat.tex "Climbing": "Once they reach the top, they must spend AP to stand
// up or finish the climb prone" — except abilities.tex "Climber III" on a
// critical — and a climb no taller than the climber is lands them standing.
export function getClimbFinish(state: CombatState, action: MoveAction, path: Coord[], fall: MoveFall | null): 'prone' | 'standing' | null {
  const c = state.characters[action.actorId]
  if (action.movement !== 'climb' || path.length === 0 || fall !== null || !c) return null
  if (isTrivialClimb(state, action, path)) return 'standing'
  return hasGrant(c, 'climbUpright') && getClimbDegree(state, action) === 'critical' ? null : 'prone'
}

// The fall a move as walked ends in, if any; `redoFell` is whether the test an
// attack had the climber make on the way was failed.
export function getMoveFall(state: CombatState, action: MoveAction, path: Coord[], redoFell: boolean): MoveFall | null {
  if (action.movement === 'jump') return getJumpFall(state, action, path)
  if (action.movement === 'climb' && hasClimbFailed(state, action, redoFell)) return getClimbFall(state, action, path)
  return null
}
