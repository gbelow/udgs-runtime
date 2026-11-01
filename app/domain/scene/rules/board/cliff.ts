import type { Character, MoveKind } from '../../../types'
import type { SceneState, Coord, Degree, HeldRoll, MoveAction, MoveFacts, MoveFall, Placement } from '../../types'
import { FALL } from '../../../tables'
import { hasGrant } from '../../../character/rules/effects'
import { getHeight, getRM } from '../../../character/rules/size'
import { getClimbTerms } from '../../../character/rules/skills'
import type { RollMode } from '../../../play/dice'
import { coordKey, sameCell } from './geometry'
import { getDegree } from '../../../play/test'
import { isCampaignCharacter } from '../../../utils'
import { getHangingLanding } from './ground'
import { getMoveOrigin, getPathPlacements } from './waypoint'
import { getClimbBack, getClimbStops, getClimbTarget, getTerrainAt } from './board'
import { getMoveHeld } from '../heldRoll'

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

// The height of the ground the mover sets out from (of their feet, for one
// hanging on a face) and then of each cell of the path; null where there is
// no board.
export function getPathElevations(state: SceneState, action: MoveAction, path: Coord[]): number[] | null {
  const from = getMoveOrigin(state, action)
  const board = state.board
  const start = from?.climb ? from.elevation : from && board ? getTerrainAt(board, from.cell, from.elevation).floor : null
  return from && board && start !== null ? [start, ...getPathPlacements(state, action, path).map((p) => p.elevation)] : null
}

// combat.tex "Climbing": "Any character starts a climb at their own height";
// abilities.tex "Jumper II": the jump spent to start the climb gains "+1m xRM
// to the starting distance".
export function getClimbStart(c: Character, leap: boolean): number {
  return getHeight(c) + (leap && hasGrant(c, 'climbLeap') ? getRM(c) : 0)
}

// combat.tex "Climbing": a climb is on one face — the step from the cell the
// climber is in to the next, over a cliff — and "can be in an intermediate
// position" on it. How it goes, read off the declaration: the height of the
// face, the climber's start (which only the first move of a climb takes),
// the metres this move covers and where that leaves them: between the floor
// the climber set out from and the one they are bound for (`getClimbTarget`),
// gripped as the face's higher side says. `passes` are how far from the floor
// set out from each floor met on the way is. `own` is a climb up or down the
// climber's own cell, and `overhead` one up to a lattice with neither raised
// ground nor a wall under it to climb (a canopy over open ground). `back` is
// a climber hanging partway down going back onto the floor they set out from.
type Face = { from: Placement; height: number; up: boolean; low: Coord; high: Coord; floor: number; bound: number; climbDL: number | null; passes: number[]; own: boolean; overhead: boolean; back: boolean }

function getFace(state: SceneState, action: MoveAction): Face | null {
  const from = getMoveOrigin(state, action)
  const to = action.path[0]
  const board = state.board
  if (!from || !to || action.path.length !== 1 || !board) return null
  const here = from.climb ? from.climb.floor : getTerrainAt(board, from.cell, from.elevation).floor
  const bound = getClimbTarget(board, from, to, action.ledge)
  if (!bound) return null
  const up = bound.floor > here
  const height = Math.abs(bound.floor - here)
  const passes = [...new Set(getClimbStops(board, from.cell, here, to).filter((s) => (s.floor > here) === up).map((s) => Math.abs(s.floor - here)).filter((d) => d > 0 && d < height))].sort((a, b) => a - b)
  const own = sameCell(from.cell, to)
  const ground = board.terrain[coordKey(to)]
  const lattice = bound.level !== null && !!board.levels[bound.level].terrain[coordKey(bound.cell)]?.lattice
  const overhead = up && lattice && !ground?.blocking && bound.floor > (ground?.elevation ?? 0)
  return { from, height, up, low: up ? from.cell : bound.cell, high: up ? bound.cell : from.cell, floor: here, bound: bound.floor, climbDL: bound.climbDL, passes, own, overhead, back: from.climb !== null && bound.floor === here && sameCell(bound.cell, from.cell) }
}

// How a climb goes along its face, in metres from the floor it set out from:
// `lead` is how far it reaches, hands going up and feet going down, and `feet`
// how far the feet are. The table's ruling: a floor met on the way is stood up
// on, which gives the climber their own height of reach from it again
// (combat.tex "Climbing": "Any character starts a climb at their own height"),
// wherever that reaches further; the metres paid are those climbed beyond
// reach, no more than `budget`. A climber out of metres short of the end hangs
// where they got to, and stands on no floor they could not climb on from.
type Course = { metres: number; stands: number; lead: number; feet: number; last: number; top: boolean }

function climbFace(face: Face, height: number, lead: number, feet: number, budget: number): Course {
  let paid = 0
  let stands = 0
  let last = 0
  const climb = (to: number) => {
    const step = Math.max(0, Math.min(to - lead, budget - paid))
    paid += step
    lead += step
    feet = face.up ? feet + step : lead
  }
  for (const d of face.passes) {
    if ((face.up && d <= feet) || d + height <= lead) continue
    climb(d)
    if (lead < d || (paid >= budget && d + height < face.height)) break
    stands += 1
    last = d
    lead = d + height
    feet = face.up ? d : lead
  }
  climb(face.height)
  return { metres: paid, stands, lead, feet: Math.min(feet, face.height), last, top: lead >= face.height }
}

// `remaining` is the metres left to pay to the end of the face, and `metres`
// those this move pays; `stands` the floors it stands up on on the way; where
// it leaves the climber, their feet at `elevation`, and, hanging, the floor
// they last stood on (`floor`) and how far they reach from it (`covered`).
// `hang` is a climb down the climber's own cell that goes no further than its
// start: they lower themselves to hang under the floor they stood on (the
// table's ruling, priced as standing up and with no test).
export type ClimbPlan = {
  face: Face
  first: boolean
  hang: boolean
  credit: number
  remaining: number
  metres: number
  stands: number
  covered: number
  floor: number
  elevation: number
  trivial: boolean
  top: boolean
}

export function getClimbPlan(state: SceneState, action: MoveAction): ClimbPlan | null {
  const c = state.characters[action.actorId]
  const face = getFace(state, action)
  if (action.movement !== 'climb' || !c || !face) return null
  const first = face.from.climb === null
  const credit = first ? getClimbStart(c, action.leap) : 0
  const lead = (face.from.climb?.covered ?? 0) + credit
  const feet = face.up ? Math.abs(face.from.elevation - face.floor) : lead
  // combat.tex "Climbing": "Any climb with height equal or lower than the
  // character's height can be done by just standing up in the new location";
  // the table's ruling: so is going back onto the floor hung from within reach
  const height = getHeight(c)
  const trivial = (first && face.height <= credit) || (face.back && lead <= height)
  const whole = climbFace(face, height, lead, feet, Infinity)
  const course = trivial ? { ...whole, metres: 0, stands: 0 } : climbFace(face, height, lead, feet, action.metres ?? Infinity)
  const along = (d: number) => (face.up ? face.floor + d : face.floor - d)
  const hang = canHang(face, first, trivial) && course.metres === 0
  return {
    face, first, credit, trivial, hang,
    remaining: trivial ? 0 : whole.metres,
    metres: course.metres,
    stands: course.stands,
    covered: course.lead - course.last,
    floor: along(course.last),
    elevation: along(course.feet),
    top: trivial || course.top,
  }
}

// The table's ruling: a climber setting out down their own cell (from a
// canopy, a branch) may stop at their start, hanging under the floor.
function canHang(face: Face, first: boolean, trivial: boolean): boolean {
  return first && !trivial && face.own && !face.up
}

// Whether the climb is one no test is made for: one no taller than the
// climber, or the start of one down taken only to hang.
export function isUntestedClimb(state: SceneState, action: MoveAction): boolean {
  const plan = getClimbPlan(state, action)
  return !!plan && (plan.trivial || plan.hang)
}

// How much of the face this move climbs, which is what it pays for.
export function getClimbCells(state: SceneState, action: MoveAction): number {
  return getClimbPlan(state, action)?.metres ?? 0
}

// What the panel offers of a climb: the metres this move goes, how many of the
// face are left to go, and the metres a metre less or more would be (null
// where the face allows no fewer or no more); null where there is nothing to
// choose.
// `hang` says the move only lowers the climber to hang, and 0 metres is
// offered where it may.
export function getClimbSteps(state: SceneState, action: MoveAction): { metres: number; remaining: number; less: number | null; more: number | null; hang: boolean } | null {
  const plan = getClimbPlan(state, action)
  if (!plan || plan.trivial || plan.remaining === 0) return null
  const least = canHang(plan.face, plan.first, plan.trivial) ? 0 : 1
  return {
    metres: plan.metres,
    remaining: plan.remaining,
    hang: plan.hang,
    less: plan.metres > least ? plan.metres - 1 : null,
    more: plan.metres < plan.remaining ? plan.metres + 1 : null,
  }
}

// combat.tex "Climbing": the floors the declared climb may stop on, nearest
// first, the last the end of the face, and the one it is bound for; a stop a
// hanging climber has already reached is not offered, but for the floor they
// hang from where they reach it (first). Null off a climb with a
// face picked.
export function getClimbChoices(state: SceneState, action: MoveAction): { cell: Coord; floor: number; chosen: boolean }[] | null {
  const from = getMoveOrigin(state, action)
  const to = action.path[0]
  const board = state.board
  if (action.movement !== 'climb' || !from || !to || action.path.length !== 1 || !board) return null
  const here = from.climb ? from.climb.floor : getTerrainAt(board, from.cell, from.elevation).floor
  const target = getClimbTarget(board, from, to, action.ledge)
  const back = getClimbBack(board, from)
  const c = state.characters[action.actorId]
  const reached = back && c && from.climb && sameCell(from.climb.to, to) && from.climb.covered <= getHeight(c) ? [back] : []
  return [...reached, ...getClimbStops(board, from.cell, here, to).filter((s) => Math.abs(s.floor - here) > (from.climb?.covered ?? 0))]
    .map((s) => ({ cell: s.cell, floor: s.floor, chosen: !!target && sameCell(target.cell, s.cell) && target.floor === s.floor }))
}

export function isTrivialClimb(state: SceneState, action: MoveAction): boolean {
  return getClimbPlan(state, action)?.trivial ?? false
}

// combat.tex "Climbing": "To determine the difficulty of climbing, consider
// ... the quality of the grips and the distance between holds" — the board
// paints the DL of each face (`climbDL`, on its higher side); a face with no
// DL has nothing to hold. Distance adds nothing: the metres climbed are
// already paid for.
export function getClimbDL(state: SceneState, action: MoveAction): number | null {
  return getClimbPlan(state, action)?.face.climbDL ?? null
}

// combat.tex "Climbing": whether the move is a climb that can be made: up or
// down one face with something to hold, unless it is no taller than the
// climber, and one already under way goes on up the face it is on.
// The table's ruling: a lattice with nothing under it to climb is reached
// only from within the climber's start.
export function isClimbable(state: SceneState, action: MoveAction): boolean {
  const plan = getClimbPlan(state, action)
  const hanging = plan?.face.from.climb
  if (plan?.face.overhead) return plan.trivial
  if (plan?.face.back) return plan.trivial
  return !!plan && (!hanging || sameCell(hanging.to, action.path[0])) && (plan.trivial || plan.hang || getClimbDL(state, action) !== null)
}

// abilities.tex "Climber": safe climbing from the first level, risky from the
// second "during a movement surge"; play.tex "Safe and risky tests": "only ...
// when indicated in the skill or ability". Before the combat has started
// (`charged`) no surge is asked.
export function getClimbModes(c: Character, charged: boolean): RollMode[] {
  const surging = !charged || (isCampaignCharacter(c) && c.usedSurge === 'movement')
  return ['normal', ...(hasGrant(c, 'safeClimb') ? ['safe' as const] : []), ...(hasGrant(c, 'riskyClimb') && surging ? ['risky' as const] : [])]
}

type ClimbTest = { score: number; mode: RollMode }

// combat.tex "Climbing": "The same test result is saved for the entire
// round" — the climber's held climbing test, and the way it was rolled.
function getHeldClimb(state: SceneState, action: MoveAction): ClimbTest | null {
  const held = getMoveHeld(state, action, 'climb')
  return held ? { score: withHolds(state, action, held), mode: held.mode } : null
}

// combat.tex "Climbing": "Add or remove the penalty to the climbing test to
// redetermine the climbing performance" — the die and every other term stay as
// rolled; the term for the free holds is the one the climber has now.
function withHolds(state: SceneState, action: MoveAction, held: HeldRoll): number {
  const c = state.characters[action.actorId]
  const now = c && getClimbTerms(c).find((t) => t.label === 'holds')?.value
  if (now === undefined) return held.score
  const then = held.skillTerms.find((t) => t.label === 'holds')?.value ?? 0
  return held.score + now - then
}

// Whether the climb is closed by a die of its own: the climber has not tested
// this round, or the move carries the test it was rolled with.
export function needsClimbTest(state: SceneState, action: MoveAction): boolean {
  return !isUntestedClimb(state, action) && (action.roll !== null || getHeldClimb(state, action) === null)
}

function getClimbTest(state: SceneState, action: MoveAction): ClimbTest | null {
  return action.roll ? { score: action.roll.score, mode: action.mode } : getHeldClimb(state, action)
}

// What the climb's test came to against this climb's DL; a climb given up is
// a failure.
export function getClimbDegree(state: SceneState, action: MoveAction): Degree | null {
  if (action.gaveUp) return 'miss'
  if (isUntestedClimb(state, action)) return null
  const test = getClimbTest(state, action)
  const DL = getClimbDL(state, action)
  return test && DL !== null ? getDegree(test.score, DL) : null
}

// abilities.tex "Climber II": whether the test that stands for the climb was
// made in a risky manner.
export function isClimbRisky(state: SceneState, action: MoveAction): boolean {
  return (getClimbTest(state, action)?.mode ?? action.mode) === 'risky'
}

// combat.tex "Climbing": "On a failure, the character simply falls" — from
// the test as made, or from the one an interrupting attack had the climber
// make (`redoFell`).
export function hasClimbFailed(state: SceneState, action: MoveAction, redoFell: boolean): boolean {
  return getClimbDegree(state, action) === 'miss' || redoFell
}

// combat.tex "Climbing": "On a failure, the character simply falls from the
// surface" — from the height they had climbed to, or, where an interrupting
// attack made them lose their hold before the move began, from the height
// they hung at (none at all for one still on the ground); null where that is
// no fall at all.
function getClimbFall(state: SceneState, action: MoveAction, redoFell: boolean): MoveFall | null {
  const plan = getClimbPlan(state, action)
  if (!plan) return null
  const floor = Math.min(plan.face.floor, plan.face.bound)
  const feet = redoFell ? (plan.first ? floor : plan.face.from.elevation) : plan.elevation
  return feet - floor >= FALL.minHeight ? { height: feet - floor, to: plan.face.low } : null
}

// combat.tex "Balance": a climber who lets go falls from where they hang,
// down the face they are on.
export function getHangingFall(state: SceneState, id: string): MoveFall | null {
  const placement = state.board?.placements[id]
  const to = placement ? getHangingLanding(placement) : null
  if (!placement?.climb || !to) return null
  return { height: Math.max(0, placement.elevation - Math.min(placement.climb.floor, placement.climb.bound)), to }
}

// combat.tex "Fall skill test": a jump that comes down on lower ground lands
// from the height it came down.
function getJumpFall(state: SceneState, action: MoveAction, path: Coord[]): MoveFall | null {
  const elevations = getPathElevations(state, action, path)
  if (!elevations || path.length === 0) return null
  const height = elevations[0] - elevations[elevations.length - 1]
  return height >= FALL.minHeight ? { height, to: null } : null
}

// combat.tex "Climbing": "Once they reach the top, they must spend AP to stand
// up or finish the climb prone" — except abilities.tex "Climber III" on a
// critical — and a climb no taller than the climber is lands them standing.
// The table's ruling: a climb down ends standing.
export function getClimbFinish(state: SceneState, action: MoveAction, fall: MoveFall | null): 'prone' | 'standing' | null {
  const plan = getClimbPlan(state, action)
  const c = state.characters[action.actorId]
  if (!plan || !c || fall !== null) return null
  if (plan.trivial) return 'standing'
  if (!plan.top) return null
  if (!plan.face.up) return 'standing'
  return hasGrant(c, 'climbUpright') && getClimbDegree(state, action) === 'critical' ? null : 'prone'
}

// combat.tex "Climbing": a climb that stops short of the top leaves its
// climber hanging on the face, at the height they climbed to, reaching on
// from the last floor they stood on.
export function getClimbHang(state: SceneState, action: MoveAction, fall: MoveFall | null): MoveFacts['hang'] {
  const plan = getClimbPlan(state, action)
  if (!plan || fall !== null || plan.trivial || plan.top) return null
  return { to: action.path[0], covered: plan.covered, elevation: plan.elevation, floor: plan.floor, bound: plan.face.bound }
}

// A step forced on someone (a crash's displacement) that put them a cliff or
// more below where they stood: they fall the rest of the way (the table's
// ruling).
function getForcedFall(state: SceneState, action: MoveAction, path: Coord[]): MoveFall | null {
  const from = getMoveOrigin(state, action)
  const end = getPathPlacements(state, action, path).at(-1)
  if (!from || !end) return null
  const height = from.elevation - end.elevation
  return height >= FALL.minHeight ? { height, to: null } : null
}

// The fall a move as walked ends in, if any; `redoFell` is whether the test an
// attack had the climber make on the way was failed.
export function getMoveFall(state: SceneState, action: MoveAction, path: Coord[], redoFell: boolean): MoveFall | null {
  if (action.forced) return getForcedFall(state, action, path)
  if (action.movement === 'jump') return getJumpFall(state, action, path)
  if (action.movement === 'climb' && !isTrivialClimb(state, action) && hasClimbFailed(state, action, redoFell)) return getClimbFall(state, action, redoFell)
  return null
}
