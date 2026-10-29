import { isCombatStarted } from './started'
import type { CampaignCharacter, Character, MoveKind, MovementKind, Posture } from '../../types'
import type { Action, SceneState, Coord, Degree, Direction, MoveAction, MoveFacts, Placement } from '../types'
import { getMoveHeld } from './heldRoll'
import { CLIMB_GRAZE_AP, CLIMB_RISKY_AP, FALL, ROUND_AP, RUN_START_AP, SWIM_FAILURE_STA, SWIM_STRUGGLE_AP, type MovementBlock } from '../../tables'
import { MOVEMENT_KINDS, POSTURES } from '../../lists'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { hasAffliction } from '../../character/rules/afflictions'
import { isImmobile } from './situational'
import { canStand } from '../../character/rules/body'
import { getJumpMovement, getMovementBlock, getMovementSpeed, getRunningJumpMovement, getStandMovement } from '../../character/rules/movement'
import { DIRECTIONS, ROTATIONS, coordKey, directionTo, disk, distance, line, ring, sameCell, setDistance, sidesBetween, subtract, walkOut } from './board/geometry'
import { getClimbBound, getClimbTarget, getFootprint, getPlacedFootprint, getTerrainAt, placeAt } from './board/board'
import { isTetherKept } from './bind'
import { canStepOver, getClimbCells, getClimbDegree, getClimbFinish, getClimbHang, getClimbModes, getClimbPlan, getMoveFall, isClimbable, isClimbRisky, isTrivialClimb } from './board/cliff'
import { hasGrant } from '../../character/rules/effects'
import { getModifiedTotal } from './modifiers'
import { canRest, getCrowdedBy, isCrossable, isInLiquid, isStoodOver, isWet, readGround, type Floor } from './board/ground'
import { getMoveDestination, getMoveOrigin, getMovePlacements, getMoveSweep, getStepPlacements, touchesGround } from './board/waypoint'
import { getSwimDegrees, getSwimFinish, isDiveLegal, readWater } from './swim'
import { getDegree } from '../../play/test'
import { isCampaignCharacter } from '../../utils'
import { getMoveTramples } from './trample'
import { isInGrapple } from './partners'
import { getInterruptionOf } from './interruption'
import { isKnockedDownByHook } from './grapple'
import { findOpenRoot, getAction, getAncestry, getDrawnOpportunityAttacks, getReactionsTo } from './log'
import { getFleeStep } from './flee'
import { withDisplaced } from './displace'

// How a character crosses the board: what each kind of movement costs it,
// which kinds it may use from where it stands, whether a declared path is
// one it can walk, and where it could get to.

// ---------------------------------------------------------------------------
// Price

// How many cells of a movement the given AP buys, whole blocks only.
export function getMoveBlockCells(c: Character, kind: MovementKind, AP: number): number {
  const block = getMovementBlock(c, kind)
  return Math.floor(AP / block.AP) * block.distance
}

// combat.tex "Movement": "moving only a fraction of a space is impossible",
// so a move is bought in whole blocks, as many as cover the cells.
export function getMoveCost(c: Character, kind: MoveKind, cells: number, swum: Degree[] = [], block = isPosture(kind) ? NO_BLOCK : getMovementBlock(c, kind)): ActionCost {
  if (isPosture(kind)) return getPostureCost(c, kind)
  if (cells <= 0 || block.distance <= 0) return NO_COST
  if (kind === 'swim') return getSwimCost(c, cells, swum)
  const blocks = Math.ceil(cells / block.distance)
  return { AP: blocks * block.AP, STA: blocks * block.STA }
}

// combat.tex "Swimming": each metre is swum as the held test came to against
// its water — perfectly at the swimmer's speed, on a graze or a failure at
// 1m per 5 AP, a failure costing STA besides. The AP of the metres adds up
// and is bought in whole blocks, as every move is.
function getSwimCost(c: Character, cells: number, swum: Degree[]): ActionCost {
  const block = getMovementBlock(c, 'swim')
  const metres = Array.from({ length: cells }, (_, i) => swum[i] ?? 'hit')
  const AP = metres.reduce((total, degree) => total + (degree === 'graze' || degree === 'miss' ? SWIM_STRUGGLE_AP : block.AP / block.distance), 0)
  return { AP: Math.ceil(AP), STA: metres.filter((degree) => degree === 'miss').length * SWIM_FAILURE_STA }
}

export function isPosture(kind: MoveKind): kind is Posture {
  return (POSTURES as readonly string[]).includes(kind)
}

// combat.tex "Movement Costs and Speeds": "Stand up & 5 -AGI/5 AP +1STA",
// never less than 1 AP (the table's ruling); going prone is free.
function getPostureCost(c: Character, posture: Posture): ActionCost {
  return posture === 'stand' ? { AP: Math.max(1, getStandMovement(c)), STA: c.movement.stand.STA } : NO_COST
}

// What the move as declared costs its actor, less what the reaction that
// opened it already paid (combat.tex "Evasion": the reflex's AP "is used to
// move and does not need to be spent again, but any STA cost must be paid").
export function getMovePrice(state: SceneState, c: Character, action: MoveAction, cells: number): ActionCost {
  // a movement the rules force on its mover is not theirs to pay for
  if (action.forced) return NO_COST
  const plan = action.movement === 'climb' && cells > 0 ? getClimbPlan(state, action) : null
  const leap = plan?.first && action.leap ? getMoveCost(c, 'jump', 1) : NO_COST
  // combat.tex "Climbing": a climb no taller than the climber costs the
  // standing up it is, or the jump that started it
  if (plan?.trivial) {
    const price = action.leap ? leap : getPostureCost(c, 'stand')
    return { AP: Math.max(0, price.AP - action.prepaid), STA: price.STA }
  }
  const climbed = action.movement === 'climb' ? getClimbDegree(state, action) : null
  const moved = plan ? Math.min(plan.metres, cells) : cells
  const cost = getMoveCost(c, action.movement, moved + Math.abs(action.dive), getSwimDegrees(state, action, cells), getMoveBlock(state, c, action, climbed))
  return { AP: Math.max(0, cost.AP + leap.AP - action.prepaid), STA: (runsFree(c, action.movement) ? 0 : cost.STA) + leap.STA }
}

// combat.tex "Interruption": a move cut short has spent only the blocks it
// walked, the last one included, and one stopped before its first step the
// first block. A climb pays the metres it goes, or its first block when an
// interrupting attack made it lose its hold before it began.
export function getWalkedCells(state: SceneState, action: MoveAction, facts: MoveFacts): number {
  const plan = action.movement === 'climb' ? getClimbPlan(state, action) : null
  if (plan && !plan.trivial) return facts.stop === 'reaction' ? Math.min(1, plan.metres) : plan.metres
  return facts.stop === 'end' ? facts.path.length : Math.min(action.path.length, Math.max(1, facts.path.length))
}

// What the move was paid beyond the price of the blocks it walked, as it
// was declared (rules/modifiers.ts).
export function getUnwalked(state: SceneState, action: MoveAction, facts: MoveFacts): ActionCost {
  const c = state.characters[action.actorId]
  if (!c || !action.cost) return NO_COST
  const walked = getModifiedTotal(state, action, getMovePrice(state, c, action, getWalkedCells(state, action, facts)))
  return { AP: Math.max(0, action.cost.AP - walked.AP), STA: Math.max(0, action.cost.STA - walked.STA) }
}

const NO_COST: ActionCost = { AP: 0, STA: 0 }
const NO_BLOCK: MovementBlock = { AP: 0, STA: 0, distance: 0 }

// combat.tex "Climbing": "On a critical, it does not cost STA. ... On a graze,
// ... 5 AP +1 STA per meter"; abilities.tex "Climber II": a climb attempted
// in a risky manner goes at "1m per AP" on a crit. The test is the one
// standing for the climb (`getClimbDegree`).
function getMoveBlock(state: SceneState, c: Character, action: MoveAction, climbed: Degree | null): MovementBlock {
  const kind = action.movement
  if (isPosture(kind)) return NO_BLOCK
  const block = getMovementBlock(c, kind)
  if (kind !== 'climb') return block
  if (climbed === 'graze') return { ...block, AP: CLIMB_GRAZE_AP }
  return climbed === 'critical' ? { ...block, STA: 0, AP: isClimbRisky(state, action) ? CLIMB_RISKY_AP : block.AP } : block
}

// combat.tex "Action surge": "Running costs no STA during a movement surge"
// — for the rest of the turn it was made in. A character's own move only:
// a push or a drag is not movement for it.
function runsFree(c: Character, kind: MoveKind): boolean {
  return kind === 'run' && isCampaignCharacter(c) && c.runsFree
}

// ---------------------------------------------------------------------------
// Which kinds

export type MovementOption = {
  kind: MoveKind
  speed: number
  block: ActionCost
  available: boolean
  reason: string | null
}

// combat.tex "Movement": crawling "is the only usable movement speed while
// prone", swimming "the only usable movement speed while swimming" — a swimmer
// may also climb out over a bank higher than the water. A move
// a reaction opened may name the kinds it grants instead (combat.tex
// "Avoiding an Explosion": on a critical "the character can run").
// combat.tex "Lame": "Cannot run, jump or use basic
// movement". combat.tex "Grappled": "Movement requires pushing or
// dragging the other participants in the grapple" — a block of push at a
// time (combat.tex "Push and drag"), though standing up crosses no cells
// and stays open to them. "Immobile: Cannot move".
export function getMovementOptions(state: SceneState, c: CampaignCharacter, action?: MoveAction): MovementOption[] {
  const prone = hasAffliction(c, 'prone')
  const lame = hasAffliction(c, 'lame')
  const swimming = isInLiquid(state, c)
  const waterNear = swimming || isNextToWater(state, c)
  const cliffNear = isNextToCliff(state, c)
  const hanging = state.board?.placements[c.id]?.climb != null
  const granted = action?.movements ?? null
  const budget = action?.budget ?? null
  const held = isInGrapple(state, c.id)
  const immobile = isImmobile(state, c)
  const moves = MOVEMENT_KINDS.map((kind): MovementOption => {
    const { AP, STA } = getMovementBlock(c, kind)
    const gate = immobile ? { available: false, reason: 'immobile' }
      : held ? { available: false, reason: 'grappled: push or drag instead' }
      : movementGate(kind, { AP, STA }, hanging, prone, lame, swimming, waterNear, cliffNear, granted, budget)
    return { kind, speed: getMovementSpeed(c, kind), block: { AP, STA: runsFree(c, kind) ? 0 : STA }, ...gate }
  })
  // standing up and going prone, for a move of the character's own: one a
  // reaction opened is the movement the reaction grants
  const postures = POSTURES.map((kind): MovementOption => {
    const reason = immobile ? 'immobile' : hanging ? 'hanging on a face' : granted !== null ? 'not what the reaction allows' : kind === 'stand' ? (!prone ? 'not prone' : !canStand(c) ? 'no legs to stand on' : isStoodOver(state, c) ? 'someone stands over them' : null) : prone ? 'already prone' : null
    return { kind, speed: 0, block: getPostureCost(c, kind), available: reason === null, reason }
  })
  return [...moves, ...postures]
}

function movementGate(kind: MovementKind, block: ActionCost, hanging: boolean, prone: boolean, lame: boolean, swimming: boolean, waterNear: boolean, cliffNear: boolean, granted: MovementKind[] | null, budget: number | null): { available: boolean; reason: string | null } {
  if (granted !== null && !granted.includes(kind)) return { available: false, reason: 'not what the reaction allows' }
  if (!withinBudget(block, budget)) return { available: false, reason: 'more AP than the reaction allows' }
  if (swimming && kind !== 'swim' && kind !== 'climb') return { available: false, reason: 'swimming' }
  if (!waterNear && kind === 'swim') return { available: false, reason: 'no water within a step' }
  if (hanging) return kind === 'climb' ? { available: true, reason: null } : { available: false, reason: 'hanging on a face' }
  if (!cliffNear && kind === 'climb') return { available: false, reason: 'no cliff within a step' }
  if (prone && !swimming && kind !== 'crawl' && kind !== 'climb') return { available: false, reason: 'prone' }
  if (lame && isLameBarred(kind)) return { available: false, reason: 'lame' }
  return { available: true, reason: null }
}

// Whether some cell the character stands on borders water, so a swim can
// take them into it.
function isNextToWater(state: SceneState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  const floor = placement && readGround(state, c.id)?.at(placement.elevation)
  return !!placement && !!floor && getFootprint(c, placement).some((cell) => disk(cell, 1).some(floor.liquid))
}

// Whether some cell the character stands on borders a floor a cliff up or
// down from it, which a climb can take them to.
function isNextToCliff(state: SceneState, c: Character): boolean {
  const board = state.board
  const placement = board?.placements[c.id]
  return !!board && !!placement && getFootprint(c, placement).some((cell) => disk(cell, 1).some((next) => !sameCell(next, cell) && getClimbBound(board, cell, placement.elevation, next) !== null))
}

// combat.tex "Lame": "Cannot run, jump or use basic movement"
export function isLameBarred(kind: MovementKind): boolean {
  return kind === 'run' || kind === 'jump' || kind === 'basic'
}

// ---------------------------------------------------------------------------
// Whether a declared path may be walked

// Whether the move as declared is one its actor can make: every step a
// neighbour of the last, every footprint along the way off blocking cells
// and in the water exactly when swimming, and the last one somewhere it may
// come to rest. The cells a jump only passes over (`touchesGround`) need
// just be unblocked, but it clears nothing as high as its vertical reach
// (`getJumpCeiling`). A walk takes no step up or down a cliff (`canStepOver`),
// and a climb is the way over one.
export function isPathLegal(state: SceneState, action: MoveAction): boolean {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  if (!c || !getMovementOptions(state, c, action).find((o) => o.kind === action.movement)?.available) return false
  if (isPosture(action.movement)) return action.path.length === 0
  const diving = action.movement === 'swim' && action.dive !== 0
  if (!from || !ground || (action.path.length === 0 && !diving)) return false
  const cells = action.movement === 'climb' ? getClimbCells(state, action) : action.path.length
  if (action.movement === 'jump' && cells > getJumpSpeed(c, action)) return false
  if (!withinBudget(getMoveCost(c, action.movement, cells + Math.abs(action.dive), getSwimDegrees(state, action, action.path.length)), action.budget)) return false

  if (action.movement === 'climb' && !(isClimbable(state, action) && (isTrivialClimb(state, action) || cells >= 1))) return false
  if (action.leap && !(action.movement === 'climb' && hasGrant(c, 'climbLeap') && !hasAffliction(c, 'lame') && !hasAffliction(c, 'prone'))) return false
  if (action.mode !== 'normal' && !(action.movement === 'climb' && getClimbModes(c, isCombatStarted(state)).includes(action.mode))) return false

  if (action.movement === 'jump' && !isStraight(from.cell, action.path)) return false

  const ceiling = getJumpCeiling(c, from)
  const sweep = getMoveSweep(state, action)
  const steps = getMovePlacements(state, action)
  let cursor = from.cell
  const rate = getTurnRate(action.movement)
  let heading: Direction | null = null
  let wet = isWet(getFootprint(c, from), ground.at(from.elevation))
  for (const [i, cell] of action.path.entries()) {
    if (distance(cursor, cell) !== 1) return false
    const way = directionTo(cursor, cell)
    if (heading !== null && rate !== null && sidesBetween(heading, way) > rate) return false
    heading = way
    const last = i === action.path.length - 1
    const footprint = sweep[i]
    const floor = ground.at(action.movement === 'jump' ? from.elevation : steps[action.movement === 'climb' ? i + 1 : i].elevation)
    if (!canPass(action.movement, footprint, floor, last, ceiling, wet)) return false
    if (action.movement !== 'climb' && !canStepOver(action.movement, floor.elevation(cursor), floor.elevation(cell))) return false
    if (!isTetherKept(state, c.id, footprint)) return false
    if (last && !canEndAt(state, c, action, footprint, floor)) return false
    cursor = cell
    wet = isWet(footprint, floor)
  }
  const end = getFootprint(c, { ...from, cell: cursor, orientation: action.orientation ?? from.orientation })
  return isDiveLegal(state, action, state.board ? readWater(state.board, end) : null)
}

// combat.tex "Movement": "If performed backwards, the horizontal distance is
// halved", and abilities.tex "Jump Shot" jumps backward (rules/jumpAttack.ts).
function getJumpSpeed(c: Character, action: MoveAction): number {
  const speed = getMovementSpeed(c, 'jump')
  return action.modifiers.jumpShot ? Math.floor(speed / 2) : speed
}

// combat.tex "Movement" — "jumping": "A jump has a vertical distance equal
// to half the horizontal distance", and "Movement cannot be voluntarily
// interrupted in the middle of a jump", so one jump is one block's distance;
// it clears ground no higher than that
// above where it sets out, so a 2m jump goes up a metre.
function getJumpCeiling(c: Character, from: Placement): number {
  return from.elevation + getMovementSpeed(c, 'jump') / 2
}

function clears(footprint: Coord[], floor: Floor, ceiling: number): boolean {
  return footprint.every((cell) => floor.elevation(cell) <= ceiling)
}

function canPass(kind: MoveKind, footprint: Coord[], floor: Floor, lands: boolean, ceiling: number, fromWater: boolean): boolean {
  if (kind === 'jump' && !clears(footprint, floor, ceiling)) return false
  return touchesGround(kind, lands) ? isCrossable(footprint, floor, kind, fromWater) : !footprint.some(floor.blocked)
}

function withinBudget(cost: ActionCost, budget: number | null): boolean {
  return budget === null || cost.AP <= budget
}

// ---------------------------------------------------------------------------
// Where the move actually ends

// The way a runner is going after `steps` cells of the path: the way the
// last of them went, or null before the first and for any movement but a
// run.
function getRunHeading(state: SceneState, action: MoveAction, steps: number): number | null {
  const step = action.movement === 'run' ? getStepPlacements(state, action, steps) : null
  return step ? directionTo(step.before.cell, step.after.cell) : null
}

// Whether a displacement keeps within a hex step of the heading: a
// non-negative combination of the two directions either side of it, which
// between them span everything up to 60 degrees off.
function isWithinCone(offset: Coord, heading: number): boolean {
  const u = DIRECTIONS[(heading + 5) % 6]
  const v = DIRECTIONS[(heading + 1) % 6]
  const det = u.q * v.r - u.r * v.q
  const a = (offset.q * v.r - offset.r * v.q) / det
  const b = (u.q * offset.r - u.r * offset.q) / det
  return a >= 0 && b >= 0
}

// combat.tex "Balance": crossing difficult terrain takes a Balance test, so a
// move whose path enters a difficult cell is committed by a die — for a
// jump, only the cell it lands on — unless the mover's test stands from
// earlier in the round (the table's ruling: the test made on difficult
// terrain is held for the round, until a fall has the mover test again,
// `dropFallenBalance`).
export function needsBalanceTest(state: SceneState, action: MoveAction): boolean {
  return firstDifficultStep(state, action) !== null && getMoveHeld(state, action, 'balance') === null
}

// The test a move's die is thrown as: its way over a cliff, or its walk across
// difficult terrain.
export function getMoveTest(state: SceneState, action: MoveAction): NonNullable<MoveAction['test']> {
  if (action.movement === 'climb') return 'climb'
  return 'balance'
}

// Every step of the path that comes down on difficult ground, with the DL of
// the worst difficult cell the mover's footprint covers there. combat.tex
// "Balance": each is held against the one stored score.
function getDifficultSteps(state: SceneState, action: MoveAction): { step: number; DL: number }[] {
  const board = state.board
  if (!board) return []
  const steps = getMovePlacements(state, action).slice(1)
  return getMoveSweep(state, action).flatMap((footprint, at) => {
    if (!touchesGround(action.movement, at === action.path.length - 1)) return []
    const DLs = footprint.map((f) => getTerrainAt(board, f, steps[at].elevation).terrain).filter((t) => t?.difficult).map((t) => t!.DL)
    return DLs.length > 0 ? [{ step: at + 1, DL: Math.max(...DLs) }] : []
  })
}

function firstDifficultStep(state: SceneState, action: MoveAction): number | null {
  return getDifficultSteps(state, action)[0]?.step ?? null
}

// The DL the move's own die is thrown against: that of the first difficult
// cell the move enters.
export function getBalanceDL(state: SceneState, action: MoveAction): number {
  return getDifficultSteps(state, action)[0]?.DL ?? 0
}

// The step the mover falls at: the first difficult cell whose DL their
// balance — their own die's score, or the remembered one — does not clear
// for the way they move.
function getFallStep(state: SceneState, action: MoveAction): number | null {
  const score = (action.roll ?? getMoveHeld(state, action, 'balance'))?.score
  if (score === undefined) return null
  return getDifficultSteps(state, action).find(({ DL }) => !isSafeOnDifficultTerrain(action.movement, getDegree(score, DL)))?.step ?? null
}

// combat.tex "Balance" — "Difficult terrain": "On a critical, all movement is
// inconsequential. On a success, only moving at a normal speed is safe, but
// not jumping or running. On a graze, moving at a careful speed is safe. On
// a miss, only crawling is allowed."
function isSafeOnDifficultTerrain(kind: MoveKind, degree: Degree): boolean {
  switch (degree) {
    case 'critical': return true
    case 'hit': return kind !== 'run' && kind !== 'jump'
    case 'graze': return kind === 'careful' || kind === 'crawl' || kind === 'swim'
    case 'miss': return kind === 'crawl'
  }
}

// Where an opportunity attack fought against the move took it over, if one
// has: one space short of the stretch that triggered it, the table's
// ruling. combat.tex "Interruption": "Movement is cancelled, except running
// and jumping" — and "running": "The first 2 AP worth of running must be
// uninterrupted, otherwise, running cannot be started", so a run is
// cancelled like any move by an interruption inside its first block.
// combat.tex "Evasive Jump": a mover who jumps away from the
// attack has made a movement of their own, and it takes over from the one
// declared, whatever the speed.
// combat.tex "Hook Attack": a mover the hook's knockdown put down goes no
// further, running or not. combat.tex "Crash": the higher force of the
// target blocks passage, and "A draw blocks passage" — a braced blow's or a
// catch's crash too. A movement the rules force goes on through an
// interruption, as a run does.
export function getMoveOverride(state: SceneState, action: MoveAction): { step: number; stop: 'reaction' | 'jump' | 'trample'; by: Action } | null {
  const mover = state.characters[action.actorId]
  const starting = action.movement === 'run' && mover ? getMoveBlockCells(mover, 'run', RUN_START_AP) : 0
  for (const { reaction, spawned: strike } of getDrawnOpportunityAttacks(state, action)) {
    if (strike?.kind !== 'strike' || strike.step !== 'done') continue
    const stoppable = !action.forced && ((action.movement !== 'run' && action.movement !== 'jump') || reaction.at! - 1 < starting)
    const jumped = getReactionsTo(state, strike.id).some((a) => a.kind === 'evasiveJump' && a.actorId === action.actorId)
    if (jumped) return { step: reaction.at! - 1, stop: 'jump', by: strike }
    const interrupted = stoppable && (action.movement !== 'climb' || isTrivialClimb(state, action)) && getInterruptionOf(strike, action.actorId) !== 'none'
    if (interrupted || isKnockedDownByHook(state, strike, action.actorId)) return { step: reaction.at! - 1, stop: 'reaction', by: strike }
    if (strike.trample?.result === 'blocked') return { step: reaction.at! - 1, stop: 'trample', by: strike }
  }
  return null
}

// combat.tex "Climbing": "An attack that interrupts the climber will require
// them to make a climbing test with a -3 penalty to avoid falling on a miss"
// instead of cancelling the climb — a fresh test for each attack, thrown with
// the climb (`redos`, thrown as each attack lands) — the path step the first
// of them failed at, or null.
function getClimbFailedAt(state: SceneState, action: MoveAction): number | null {
  if (action.movement !== 'climb' || isTrivialClimb(state, action)) return null
  const failed = getDrawnOpportunityAttacks(state, action).find(({ reaction, spawned }) =>
    spawned?.kind === 'strike' && spawned.step === 'done' && getInterruptionOf(spawned, action.actorId) !== 'none' && action.redos[reaction.id]?.degree === 'miss')
  return failed ? failed.reaction.at! - 1 : null
}

// combat.tex "Climbing": the climb a landing strike interrupts, which has its
// climber test again, and the opportunity attack or preparation the strike was
// opened by; null for any other landing.
export function getInterruptedClimb(state: SceneState, landed: Action): { move: MoveAction; reactionId: string } | null {
  if (landed.kind !== 'strike' || !landed.targetId || getInterruptionOf(landed, landed.targetId) === 'none') return null
  const found = getAncestry(state, landed).find((a) => a.kind === 'opportunityAttack' || a.kind === 'prepared')
  const move = found?.reactionTo ? getAction(state, found.reactionTo) : null
  if (!found || move?.kind !== 'move' || move.movement !== 'climb' || move.actorId !== landed.targetId || isTrivialClimb(state, move)) return null
  return { move, reactionId: found.id }
}

// The path as it will be walked and why it ends where it does: someone
// fleeing it (combat.tex "Flee": the mover stops where the
// flee was triggered, and pays only for the steps walked), an opportunity
// attack that interrupted the mover or that they jumped away from, a target
// who blocked their passage (combat.tex "Crash"), a fall at the first
// difficult cell the test did not clear — whichever comes first. The
// tramples are those on the path as walked, and the fall is the one a jump
// down or a climb that failed ends in (`getMoveFall`).
export function getMoveFacts(state: SceneState, action: MoveAction): MoveFacts {
  if (action.movement === 'climb' && !isTrivialClimb(state, action)) return getClimbFacts(state, action)
  const walked = getWalkedPath(state, action)
  const { tramples } = walked
  let { path, stop } = walked
  const free = path.slice(0, getFreeStep(state, action, path.length))
  if (stop === 'end' && free.length < path.length) stop = 'occupied'
  path = free
  const fallAt = getFallStep(state, action)
  const fell = fallAt !== null && fallAt <= path.length
  if (fell) {
    path = path.slice(0, fallAt)
    stop = 'fall'
  }
  const fall = getMoveFall(state, action, path, false)
  return { path, stop, fell, fall, finish: getClimbFinish(state, action, fall) ?? getSwimFinish(state, action, path), hang: null, trampled: tramples.trampled.filter((t) => t.at <= path.length + (t.result === 'blocked' ? 1 : 0)) }
}

// The path as far as the move is walked before the mover is stood short of
// anyone in the space it would end in: cut short by a flee, an opportunity
// attack, or a crash that blocked it.
export function getWalkedPath(state: SceneState, action: MoveAction): { path: Coord[]; stop: MoveFacts['stop']; tramples: ReturnType<typeof getMoveTramples> } {
  let path = action.path
  let stop: MoveFacts['stop'] = 'end'
  const flee = getFleeStep(state, action)
  if (flee !== null && flee - 1 < path.length) {
    path = path.slice(0, flee - 1)
    stop = 'flee'
  }
  const override = getMoveOverride(state, action)
  if (override !== null && override.step < path.length) {
    path = path.slice(0, override.step)
    stop = override.stop
  }
  const tramples = getMoveTramples(state, action, path)
  if (tramples.stop !== null) {
    path = path.slice(0, tramples.stop)
    stop = 'trample'
  }
  return { path, stop, tramples }
}

// The step of the move, at or before `steps`, the mover may stand at; 0 is
// where it set out. A mover stopped partway may have been let through someone
// (an evaded crash, a prone body, anyone they pass while an attack is fought)
// whose space they would stand in, and one who walked the whole way may find
// their end taken by someone a reaction moved there: two characters rest on
// one space only when one of them is prone (`getCrowdedBy`), so they stand on
// the last space before it. One the mover's crash displaces is read where the
// attacker puts them (rules/displace.ts).
export function getFreeStep(state: SceneState, action: MoveAction, steps: number): number {
  let at = steps
  while (at > 0 && getStandingIn(state, action, action.path[at - 1]) !== null) at--
  return at
}

// Whoever stands in the space the mover would come to rest in with their
// anchor on `cell`, as the move would end there; null for nobody.
export function getStandingIn(state: SceneState, action: MoveAction, cell: Coord): string | null {
  const mover = state.characters[action.actorId]
  const end = getMoveDestination(state, action, [cell])
  const placed = withDisplaced(state, action)
  const floor = end && readGround(placed, action.actorId)?.at(end.elevation)
  return mover && end && floor ? getCrowdedBy(placed, mover, getFootprint(mover, end), floor, endsLying(mover, action.movement)) : null
}

// Whether the move may be declared to end on the footprint: where the mover
// may rest, or, for a move of the mover's own, in the space of anyone standing
// there (combat.tex "Crash": the trample decides who stands there once it
// lands). Never where someone hangs over it.
function canEndAt(state: SceneState, c: Character, action: MoveAction, footprint: Coord[], floor: Floor): boolean {
  return canRest(state, c, footprint, floor, endsLying(c, action.movement)) || (action.spawnedBy === null && footprint.every((cell) => floor.heldFor(cell).length === 0))
}

// combat.tex "Movement": crawling "is the only usable movement speed while
// prone", so a prone character's crawl comes to rest lying down. A climb may
// end standing.
function endsLying(c: Character, kind: MoveKind): boolean {
  return kind === 'crawl' && hasAffliction(c, 'prone')
}

// combat.tex "Climbing": a climb goes up the face it is on, as far as the metres
// it declares, or ends in the fall of a test that failed — the climber's, or
// the one an interrupting attack had them make — and leaves its climber at
// the top, or hanging part of the way.
function getClimbFacts(state: SceneState, action: MoveAction): MoveFacts {
  const plan = getClimbPlan(state, action)
  const redoFell = getClimbFailedAt(state, action) !== null
  const fall = getMoveFall(state, action, action.path, redoFell)
  return {
    path: plan?.top && fall === null ? action.path : [],
    stop: redoFell ? 'reaction' : fall ? 'fall' : 'end',
    fell: false,
    fall,
    finish: getClimbFinish(state, action, fall),
    hang: getClimbHang(state, action, fall),
    trampled: [],
  }
}

// ---------------------------------------------------------------------------
// Jumping clear

// The move the character is in the middle of, if an opportunity attack has
// them stood part of the way along one.
function getMoveUnderway(state: SceneState, id: string): MoveAction | null {
  return findOpenRoot(state, 'move', (m) => m.actorId === id && m.step === 'post')
}

// How far along the move underway the character has walked: the step of the
// path they stand on, or 0 at its origin.
function getStepsWalked(state: SceneState, action: MoveAction): number {
  const here = state.board?.placements[action.actorId]?.cell
  const i = here ? action.path.findIndex((cell) => sameCell(cell, here)) : -1
  return i + 1
}

// combat.tex "Movement" — "jumping": "Movement cannot be voluntarily
// interrupted in the middle of a jump." A character hit part of the way
// through a jump cannot jump clear of the attack.
export function isMidJump(state: SceneState, id: string): boolean {
  return getMoveUnderway(state, id)?.movement === 'jump'
}

// combat.tex "Evasive Jump": "This can only be used if there is space to
// jump. The jump must place the character further from the source of the
// attack and uses the movement speed of jumping backwards" — half the jump
// ("Movement": "If performed backwards, the horizontal distance is halved"),
// in whole cells. Every other anchor within that many cells, in any
// orientation, whose footprint may stand where it lands (creating.tex "Size
// and Space Occupation", as `canStandAt` reads it) and ends at least one
// cell further from the attacker than it began. A runner hit mid-run may
// jump any way, but within a hex step of the way they were going the jump
// is a forward one out of the run and reaches the running long jump
// ("Evasive Jump": "at a 60 degree angle of the direction of the run").
// It lands only on ground its vertical reach clears (`getJumpCeiling`), and
// not down a cliff, which would be a fall. One hit mid-jump cannot jump at all.
export function getEvasiveJumpPlacements(state: SceneState, defenderId: string, attackerId: string): Placement[] {
  const defender = state.characters[defenderId]
  const from = state.board?.placements[defenderId]
  const attacker = getPlacedFootprint(state, attackerId)
  const strike = findOpenRoot(state, 'strike', (s) => s.actorId === attackerId && s.targetId === defenderId)
  const floor = from && readGround(state, defenderId, strike ? getStrikeLandings(state, strike.id, defenderId) : {})?.at(from.elevation)
  if (!defender || !from || !attacker || !floor || isMidJump(state, defenderId)) return []
  const underway = getMoveUnderway(state, defenderId)
  const heading = underway ? getRunHeading(state, underway, getStepsWalked(state, underway)) : null
  const before = setDistance(getFootprint(defender, from), attacker)
  const hop = Math.floor(getJumpMovement(defender) / 2)
  const leap = heading === null ? hop : Math.max(hop, Math.floor(getRunningJumpMovement(defender)))
  const reaches = (cell: Coord) => distance(cell, from.cell) <= hop || (heading !== null && isWithinCone(subtract(cell, from.cell), heading))
  const placements: Placement[] = []
  for (const cell of disk(from.cell, leap)) {
    if (sameCell(cell, from.cell) || !reaches(cell)) continue
    if (floor.elevation(from.cell) - floor.elevation(cell) >= FALL.minHeight) continue
    for (const orientation of ROTATIONS) {
      const to = { ...placeAt(state.board, from, cell), orientation }
      const footprint = getFootprint(defender, to)
      if (!footprint.some(floor.blocked) && clears(footprint, floor, getJumpCeiling(defender, from)) && canRest(state, defender, footprint, floor, false) && setDistance(footprint, attacker) > before) placements.push(to)
    }
  }
  return placements
}

// Where everyone but `except` answering the strike comes to rest when it
// lands: a Defender's or a Defensive Advance's step, an evasive jump's
// landing. They land together, so a step or a jump picked for the same
// strike may not be put down on any of them.
export function getStrikeLandings(state: SceneState, strikeId: string, except: string): Record<string, Placement> {
  return Object.fromEntries(getReactionsTo(state, strikeId).flatMap((r) =>
    (r.kind === 'block' || r.kind === 'intercept' || r.kind === 'evasiveJump') && r.to && r.actorId !== except ? [[r.actorId, r.to]] : []))
}

export function hasJumpSpace(state: SceneState, defenderId: string, attackerId: string): boolean {
  if (!state.board?.placements[defenderId] || !state.board.placements[attackerId]) return true
  return getEvasiveJumpPlacements(state, defenderId, attackerId).length > 0
}

// ---------------------------------------------------------------------------
// Reach of a move

export type ReachableCell = { cell: Coord; steps: number; cost: ActionCost; path: Coord[] }

// Every anchor the character can walk to at the move's kind of movement
// and pay for as they stand, with the shortest path there: a breadth-first
// walk over cells its footprint (as oriented now) may cross, stopping where
// the price outruns what it has or the move's cap. Cells it may cross but
// not rest on are walked through and left out. A move drawn in segments
// (`drawsSegments`) walks on from the end of the path drawn so far, and each
// path found is that path and the walk after it; a run keeps to its turn
// rate across the join. A jump goes only in a straight line.
export function getWalkableCells(state: SceneState, action: MoveAction): ReachableCell[] {
  const { actorId, movement: kind } = action
  const c = state.characters[actorId]
  const from = state.board?.placements[actorId]
  const ground = readGround(state, actorId)
  if (!c || !from || !ground || isPosture(kind)) return []
  if (!getMovementOptions(state, c, action).find((o) => o.kind === kind)?.available) return []

  // the walk stops where even the best swum path outruns the price; the path
  // found is then priced as it is swum. Before the combat has started the
  // move is free, but goes no further than a round's AP would carry it.
  const best = { ...action, dive: 0, path: [] }
  const payable = (cost: ActionCost) => (isCombatStarted(state) ? canAfford(c, cost, true) : cost.AP <= ROUND_AP)
  const drawn = drawsSegments(kind) ? action.path : []
  const affordable = (steps: number) => {
    const total = drawn.length + steps
    if (kind === 'jump' && total > getJumpSpeed(c, action)) return false
    return payable(getMovePrice(state, c, best, total)) && withinBudget(getMoveCost(c, kind, total), action.budget)
  }
  const ceiling = getJumpCeiling(c, from)
  const start = drawn.at(-1) ?? from.cell
  const stepFrom = (path: Coord[]) => (path.length > 1 ? path[path.length - 2] : path.length === 1 ? start : (drawn.at(-2) ?? from.cell))
  // how high the feet are on each cell the walk has come to, the first way it
  // came there; a jump's are where it set out
  const feet = new Map([[coordKey(start), drawn.length > 0 ? getMovePlacements(state, action).at(-1)?.elevation ?? from.elevation : from.elevation]])
  const floorAt = (cell: Coord) => ground.at(kind === 'jump' ? from.elevation : feet.get(coordKey(cell)) ?? from.elevation)
  const wetAt = (cell: Coord) => isWet(getFootprint(c, { ...from, cell }), floorAt(cell))
  // a step is entered the same way whatever heading it is come at from
  const entered = new Map<string, boolean>()
  const enter = (cell: Coord, path: Coord[]) => {
    const before = stepFrom(path)
    const key = `${coordKey(before)}>${coordKey(cell)}`
    const known = entered.get(key)
    if (known !== undefined) return known
    const bound = kind === 'climb' && state.board ? getClimbTarget(state.board, from, cell) : null
    const floor = bound ? ground.at(bound.floor) : floorAt(before)
    const crosses = kind === 'climb' ? bound !== null : canStepOver(kind, floor.elevation(before), floor.elevation(cell))
    const ok = crosses && canPass(kind, getFootprint(c, { ...from, cell }), floor, false, ceiling, wetAt(before))
    if (ok && !feet.has(coordKey(cell))) feet.set(coordKey(cell), floor.elevation(cell))
    entered.set(key, ok)
    return ok
  }
  const heading = drawn.length > 0 ? directionTo(stepFrom([]), start) : null
  const turnRate = getTurnRate(kind)
  // the cells drawn on already, and where the move sets out, take the path
  // back to them when picked (`pickPathCell`), so they are not offered
  const onPath = new Set([from.cell, ...drawn].map(coordKey))
  const walked = kind === 'jump'
    ? getJumps(from.cell, affordable, enter)
    : walkOut(start, affordable, enter, turnRate === null ? undefined : { heading, turn: turnRate })
  return walked
    .filter(({ cell, path }) => {
      const footprint = getFootprint(c, { ...from, cell })
      const floor = floorAt(cell)
      return !onPath.has(coordKey(cell)) && isCrossable(footprint, floor, kind, wetAt(stepFrom(path))) && canEndAt(state, c, action, footprint, floor) && (kind !== 'climb' || (path.length === 1 && isClimbable(state, { ...action, path })))
    })
    .map(({ cell, path }) => ({ cell, path: [...drawn, ...path] }))
    .map(({ cell, path }) => ({ cell, steps: path.length, cost: getMovePrice(state, c, { ...action, dive: 0, path, metres: kind === 'climb' ? 1 : action.metres }, path.length), path }))
    .filter(({ cost }) => payable(cost))
}

// Whether a kind of movement is drawn in segments, each walked on from the
// end of the last: all but a jump, which goes in a straight line, and a
// climb, which is one face.
export function drawsSegments(kind: MoveKind): boolean {
  return kind !== 'jump' && kind !== 'climb' && !isPosture(kind)
}

// How many sides of a hex a step of the movement may turn off the step
// before it, null for any. combat.tex "Movement": "The maximum turn rate
// during running is 60 degrees", one side a step; a run may set out any way.
function getTurnRate(kind: MoveKind): number | null {
  return kind === 'run' ? 1 : null
}

// combat.tex "Movement": a jump cannot be "turned in the middle", so its
// path is the straight line from where it sets out.
function isStraight(from: Coord, path: Coord[]): boolean {
  const end = path.at(-1)
  if (!end) return true
  const straight = getJumpPath(from, end)
  return straight.length === path.length && straight.every((cell, i) => sameCell(cell, path[i]))
}

// The way a jump goes from where it sets out to where it lands.
function getJumpPath(from: Coord, to: Coord): Coord[] {
  return line(from, to).slice(1)
}

// Every cell a jump may go to in a straight line, as far as `further`
// allows, whose cells on the way `enter` all admitted.
function getJumps(from: Coord, further: (steps: number) => boolean, enter: (cell: Coord, path: Coord[]) => boolean): { cell: Coord; path: Coord[] }[] {
  const jumps: { cell: Coord; path: Coord[] }[] = []
  for (let steps = 1; further(steps); steps++) {
    for (const cell of ring(from, steps)) {
      const path = getJumpPath(from, cell)
      if (path.every((p, i) => enter(p, i === 0 ? [p] : [path[i - 1], p]))) jumps.push({ cell, path })
    }
  }
  return jumps
}
