import type { Character, MoveKind } from '../../types'
import type { CombatState, Coord, Degree, HeldRoll, MoveAction, MoveFacts, MoveFall, Placement } from '../types'
import { CLIMB_HEIGHT, FALL } from '../../tables'
import { hasGrant } from '../../character/rules/abilities'
import { getRM } from '../../character/rules/size'
import { getClimbTerms } from '../../character/rules/skills'
import type { RollMode } from '../../play/dice'
import { coordKey, sameCell } from '../geometry'
import { getDegree } from '../../play/test'
import { isCampaignCharacter } from '../../utils'
import { readGround } from './ground'
import { getMoveOrigin } from './waypoint'
import { getMoveHeld } from './heldRoll'

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
// a swimmer leaves the water only onto a bank level with its surface. combat.tex "Climbing": a climb is
// over cliffs alone; the ground between them is not climbed, and the next
// cliff starts a climb of its own.
export function canStepOver(kind: MoveKind, from: number, to: number): boolean {
  if (kind === 'climb') return isCliff(from, to)
  return kind === 'jump' || !isCliff(from, to)
}

// The height of the ground the mover sets out from and then of each cell of
// the path; null where there is no board.
export function getPathElevations(state: CombatState, action: MoveAction, path: Coord[]): number[] | null {
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  return from && ground ? [ground.elevation(from.cell), ...path.map((cell) => ground.elevation(cell))] : null
}

// combat.tex "Climbing": "Any character starts a climb at their own height"
// (creating.tex "Reach Multiplier (RM)"); abilities.tex "Jumper II": the jump
// spent to start the climb gains "+1m xRM to the starting distance".
export function getClimbStart(c: Character, leap: boolean): number {
  const RM = getRM(c)
  return CLIMB_HEIGHT * RM + (leap && hasGrant(c, 'climbLeap') ? RM : 0)
}

// combat.tex "Climbing": a climb is on one face — the step from the cell the
// climber is in to the next, over a cliff — and "can be in an intermediate
// position" on it. How it goes, read off the declaration: the height of the
// face, the climber's start (which only the first move of a climb takes),
// the metres this move covers and where that leaves them.
type Face = { from: Placement; height: number; up: boolean; low: Coord; high: Coord }

function getFace(state: CombatState, action: MoveAction): Face | null {
  const from = getMoveOrigin(state, action)
  const to = action.path[0]
  const ground = readGround(state, action.actorId)
  if (!from || !to || action.path.length !== 1 || !ground) return null
  const [here, there] = [ground.elevation(from.cell), ground.elevation(to)]
  if (!isCliff(here, there)) return null
  return { from, height: Math.abs(there - here), up: there > here, low: there > here ? from.cell : to, high: there > here ? to : from.cell }
}

export type ClimbPlan = {
  face: Face
  first: boolean
  credit: number
  remaining: number
  metres: number
  covered: number
  trivial: boolean
  top: boolean
}

export function getClimbPlan(state: CombatState, action: MoveAction): ClimbPlan | null {
  const c = state.characters[action.actorId]
  const face = getFace(state, action)
  if (action.movement !== 'climb' || !c || !face) return null
  const first = face.from.climb === null
  const credit = first ? getClimbStart(c, action.leap) : 0
  const before = (face.from.climb?.covered ?? 0) + credit
  // combat.tex "Climbing": "Any climb with height equal or lower than the
  // character's height can be done by just standing up in the new location"
  const trivial = first && face.height <= credit
  const remaining = Math.max(0, face.height - before)
  const metres = trivial ? 0 : Math.min(action.metres ?? remaining, remaining)
  return { face, first, credit, remaining, metres, covered: before + metres, trivial, top: before + metres >= face.height }
}

// How much of the face this move climbs, which is what it pays for.
export function getClimbCells(state: CombatState, action: MoveAction): number {
  return getClimbPlan(state, action)?.metres ?? 0
}

// What the panel offers of a climb: the metres this move goes and how many of
// the face are left to go; null where there is nothing to choose.
export function getClimbSteps(state: CombatState, action: MoveAction): { metres: number; remaining: number } | null {
  const plan = getClimbPlan(state, action)
  return plan && !plan.trivial ? { metres: plan.metres, remaining: plan.remaining } : null
}

export function isTrivialClimb(state: CombatState, action: MoveAction): boolean {
  return getClimbPlan(state, action)?.trivial ?? false
}

// combat.tex "Climbing": "To determine the difficulty of climbing, consider
// ... the quality of the grips and the distance between holds" — the board
// paints the DL of each face (`climbDL`, on the higher cell); a face with no
// DL has nothing to hold. Distance adds nothing: the metres climbed are
// already paid for.
export function getClimbDL(state: CombatState, action: MoveAction): number | null {
  const plan = getClimbPlan(state, action)
  return plan ? state.board?.terrain[coordKey(plan.face.high)]?.climbDL ?? null : null
}

// combat.tex "Climbing": whether the move is a climb that can be made: up or
// down one face with something to hold, unless it is no taller than the
// climber, and one already under way goes on up the face it is on.
export function isClimbable(state: CombatState, action: MoveAction): boolean {
  const plan = getClimbPlan(state, action)
  const hanging = plan?.face.from.climb
  return !!plan && (!hanging || sameCell(hanging.to, action.path[0])) && (plan.trivial || getClimbDL(state, action) !== null)
}

// abilities.tex "Climber": safe climbing from the first level, risky from the
// second "during a movement surge"; play.tex "Safe and risky tests": "only ...
// when indicated in the skill or ability".
export function getClimbModes(c: Character): RollMode[] {
  const surging = isCampaignCharacter(c) && c.usedSurge === 'movement'
  return ['normal', ...(hasGrant(c, 'safeClimb') ? ['safe' as const] : []), ...(hasGrant(c, 'riskyClimb') && surging ? ['risky' as const] : [])]
}

type ClimbTest = { score: number; mode: RollMode }

// combat.tex "Climbing": "The same test result is saved for the entire
// round" — the climber's held climbing test, and the way it was rolled.
function getHeldClimb(state: CombatState, action: MoveAction): ClimbTest | null {
  const held = getMoveHeld(state, action, 'climb')
  return held ? { score: withHolds(state, action, held), mode: held.mode } : null
}

// combat.tex "Climbing": "Add or remove the penalty to the climbing test to
// redetermine the climbing performance" — the die and every other term stay as
// rolled; the term for the free holds is the one the climber has now.
function withHolds(state: CombatState, action: MoveAction, held: HeldRoll): number {
  const c = state.characters[action.actorId]
  const now = c && getClimbTerms(c).find((t) => t.label === 'holds')?.value
  if (now === undefined) return held.score
  const then = held.skillTerms.find((t) => t.label === 'holds')?.value ?? 0
  return held.score + now - then
}

// Whether the climb is closed by a die of its own: the climber has not tested
// this round, or the move carries the test it was rolled with.
export function needsClimbTest(state: CombatState, action: MoveAction): boolean {
  return !isTrivialClimb(state, action) && (action.roll !== null || getHeldClimb(state, action) === null)
}

function getClimbTest(state: CombatState, action: MoveAction): ClimbTest | null {
  return action.roll ? { score: action.roll.score, mode: action.mode } : getHeldClimb(state, action)
}

// What the climb's test came to against this climb's DL; a climb given up is
// a failure.
export function getClimbDegree(state: CombatState, action: MoveAction): Degree | null {
  if (action.gaveUp) return 'miss'
  if (isTrivialClimb(state, action)) return null
  const test = getClimbTest(state, action)
  const DL = getClimbDL(state, action)
  return test && DL !== null ? getDegree(test.score, DL) : null
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

// The feet of a climber after the metres this move climbs: up the face from
// where they were, or down it from the start they hang from.
function getClimbFeet(plan: ClimbPlan): number {
  return plan.face.up ? plan.face.from.elevation + plan.metres : plan.face.from.elevation - plan.credit - plan.metres
}

// combat.tex "Climbing": "On a failure, the character simply falls from the
// surface" — from the height they had climbed to, or, where an interrupting
// attack made them lose their hold before the move began, from the height
// they hung at (none at all for one still on the ground); null where that is
// no fall at all.
function getClimbFall(state: CombatState, action: MoveAction, redoFell: boolean): MoveFall | null {
  const plan = getClimbPlan(state, action)
  const ground = readGround(state, action.actorId)
  if (!plan || !ground) return null
  const floor = ground.elevation(plan.face.low)
  const feet = redoFell ? (plan.first ? floor : plan.face.from.elevation) : getClimbFeet(plan)
  return feet - floor >= FALL.minHeight ? { height: feet - floor, to: plan.face.low } : null
}

// combat.tex "Balance": a climber who lets go falls from where they hang,
// down the face they are on.
export function getHangingFall(state: CombatState, id: string): MoveFall | null {
  const placement = state.board?.placements[id]
  const ground = readGround(state, id)
  if (!placement?.climb || !ground) return null
  const [here, there] = [ground.elevation(placement.cell), ground.elevation(placement.climb.to)]
  return { height: Math.max(0, placement.elevation - Math.min(here, there)), to: there > here ? placement.cell : placement.climb.to }
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
export function getClimbFinish(state: CombatState, action: MoveAction, fall: MoveFall | null): 'prone' | 'standing' | null {
  const plan = getClimbPlan(state, action)
  const c = state.characters[action.actorId]
  if (!plan || !c || fall !== null) return null
  if (plan.trivial) return 'standing'
  if (!plan.top) return null
  return hasGrant(c, 'climbUpright') && getClimbDegree(state, action) === 'critical' ? null : 'prone'
}

// combat.tex "Climbing": a climb that stops short of the top leaves its
// climber hanging on the face, at the height they climbed to.
export function getClimbHang(state: CombatState, action: MoveAction, fall: MoveFall | null): MoveFacts['hang'] {
  const plan = getClimbPlan(state, action)
  const c = state.characters[action.actorId]
  if (!plan || !c || fall !== null || plan.trivial || plan.top) return null
  return { to: action.path[0], covered: plan.covered, upright: hasGrant(c, 'climbUpright') && getClimbDegree(state, action) === 'critical', elevation: getClimbFeet(plan) }
}

// The fall a move as walked ends in, if any; `redoFell` is whether the test an
// attack had the climber make on the way was failed.
export function getMoveFall(state: CombatState, action: MoveAction, path: Coord[], redoFell: boolean): MoveFall | null {
  if (action.movement === 'jump') return getJumpFall(state, action, path)
  if (action.movement === 'climb' && !isTrivialClimb(state, action) && hasClimbFailed(state, action, redoFell)) return getClimbFall(state, action, redoFell)
  return null
}
