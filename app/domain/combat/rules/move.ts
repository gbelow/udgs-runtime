import type { CampaignCharacter, Character, MoveKind, MovementKind, Posture } from '../../types'
import type { CombatState, Coord, Degree, MoveAction, MoveFacts, Placement } from '../types'
import { MOVEMENT_BLOCK_COST, RUN_START_AP } from '../../tables'
import { MOVEMENT_KINDS, POSTURES } from '../../lists'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { hasAffliction } from '../../character/rules/afflictions'
import { isImmobile } from './situational'
import { canStand } from '../../character/rules/body'
import { getJumpMovement, getMovementSpeed, getRunningJumpMovement, getStandMovement } from '../../character/rules/movement'
import { DIRECTIONS, ROTATIONS, coordKey, directionTo, disk, distance, sameCell, setDistance, subtract, walkOut } from '../geometry'
import { getFootprint, getPlacedFootprint } from './board'
import { isTetherKept } from './bind'
import { canRest, isCrossable, isInLiquid, readGround, type Ground } from './ground'
import { getMoveOrigin, getStepPlacements, touchesGround } from './waypoint'
import { isCampaignCharacter } from '../../utils'
import { getMoveTramples } from './trample'
import { isInGrapple } from './partners'
import { getInterruptionOf } from './interruption'
import { isKnockedDownByHook } from './grapple'
import { findOpenRoot, getDrawnOpportunityAttacks, getReactionsTo } from './log'
import { getFleeStep } from './flee'

// How a character crosses the board: what each kind of movement costs it,
// which kinds it may use from where it stands, whether a declared path is
// one it can walk, and where it could get to.

// ---------------------------------------------------------------------------
// Price

// How many cells of a movement the given AP buys, whole blocks only.
export function getMoveBlockCells(c: Character, kind: MovementKind, AP: number): number {
  return Math.floor(AP / MOVEMENT_BLOCK_COST[kind].AP) * getMovementSpeed(c, kind)
}

// combat.tex "Movement": "moving only a fraction of a space is impossible",
// so a move is bought in whole blocks, as many as cover the cells. A speed
// is printed to two places (0.33 for a third), so the quotient is read to a
// tenth before it is rounded up, or a third of a metre three times would
// cost a fourth block.
export function getMoveCost(c: Character, kind: MoveKind, cells: number): ActionCost {
  if (isPosture(kind)) return getPostureCost(c, kind)
  const speed = getMovementSpeed(c, kind)
  if (cells <= 0 || speed <= 0) return { AP: 0, STA: 0 }
  const blocks = Math.ceil(Math.round((cells / speed) * 10) / 10)
  const block = MOVEMENT_BLOCK_COST[kind]
  return { AP: blocks * block.AP, STA: blocks * block.STA }
}

export function isPosture(kind: MoveKind): kind is Posture {
  return (POSTURES as readonly string[]).includes(kind)
}

// combat.tex "Movement Costs and Speeds": "Stand up & 5 -AGI/5 AP", never
// less than 1 AP (the table's ruling); going prone is free.
function getPostureCost(c: Character, posture: Posture): ActionCost {
  return posture === 'stand' ? { AP: Math.max(1, getStandMovement(c)), STA: 0 } : { AP: 0, STA: 0 }
}

// What the move as declared costs its actor, less what the reaction that
// opened it already paid (combat.tex "Evasion": the reflex's AP "is used to
// move and does not need to be spent again, but any STA cost must be paid").
export function getMovePrice(c: Character, action: MoveAction, cells: number): ActionCost {
  const cost = getMoveCost(c, action.movement, cells)
  return { AP: Math.max(0, cost.AP - action.prepaid), STA: runsFree(c, action.movement) ? 0 : cost.STA }
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
// prone", swimming "the only usable movement speed while swimming". A move
// a reaction opened may name the kinds it grants instead (combat.tex
// "Avoiding an Explosion": on a critical "the character can run").
// combat.tex "Lame": "Cannot run, jump or use basic
// movement". combat.tex "Grappled": "Movement requires pushing or
// dragging the other participants in the grapple" — a block of push at a
// time (combat.tex "Push and drag"), though standing up crosses no cells
// and stays open to them. "Immobile: Cannot move".
export function getMovementOptions(state: CombatState, c: CampaignCharacter, action?: MoveAction): MovementOption[] {
  const prone = hasAffliction(c, 'prone')
  const lame = hasAffliction(c, 'lame')
  const swimming = isInLiquid(state, c)
  const granted = action?.movements ?? null
  const budget = action?.budget ?? null
  const held = isInGrapple(state, c.id)
  const immobile = isImmobile(state, c)
  const moves = MOVEMENT_KINDS.map((kind): MovementOption => {
    const gate = immobile ? { available: false, reason: 'immobile' }
      : held ? { available: false, reason: 'grappled: push or drag instead' }
      : movementGate(kind, prone, lame, swimming, granted, budget)
    const block = MOVEMENT_BLOCK_COST[kind]
    return { kind, speed: getMovementSpeed(c, kind), block: runsFree(c, kind) ? { ...block, STA: 0 } : block, ...gate }
  })
  // standing up and going prone, for a move of the character's own: one a
  // reaction opened is the movement the reaction grants
  const postures = POSTURES.map((kind): MovementOption => {
    const reason = immobile ? 'immobile' : granted !== null ? 'not what the reaction allows' : kind === 'stand' ? (!prone ? 'not prone' : canStand(c) ? null : 'no legs to stand on') : prone ? 'already prone' : null
    return { kind, speed: 0, block: getPostureCost(c, kind), available: reason === null, reason }
  })
  return [...moves, ...postures]
}

function movementGate(kind: MovementKind, prone: boolean, lame: boolean, swimming: boolean, granted: MovementKind[] | null, budget: number | null): { available: boolean; reason: string | null } {
  if (granted !== null && !granted.includes(kind)) return { available: false, reason: 'not what the reaction allows' }
  if (!withinBudget(MOVEMENT_BLOCK_COST[kind], budget)) return { available: false, reason: 'more AP than the reaction allows' }
  if (swimming && kind !== 'swim') return { available: false, reason: 'swimming' }
  if (!swimming && kind === 'swim') return { available: false, reason: 'not in water' }
  if (prone && !swimming && kind !== 'crawl') return { available: false, reason: 'prone' }
  if (lame && isLameBarred(kind)) return { available: false, reason: 'lame' }
  return { available: true, reason: null }
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
// (`getJumpCeiling`).
export function isPathLegal(state: CombatState, action: MoveAction): boolean {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  if (!c || !getMovementOptions(state, c, action).find((o) => o.kind === action.movement)?.available) return false
  if (isPosture(action.movement)) return action.path.length === 0
  if (!from || !ground || action.path.length === 0) return false
  if (!withinBudget(getMoveCost(c, action.movement, action.path.length), action.budget)) return false

  const ceiling = getJumpCeiling(c, from)
  let cursor = from.cell
  for (const [i, cell] of action.path.entries()) {
    if (distance(cursor, cell) !== 1) return false
    const last = i === action.path.length - 1
    const orientation = last && action.orientation !== null ? action.orientation : from.orientation
    const footprint = getFootprint(c, { ...from, cell, orientation })
    if (!canPass(action.movement, footprint, ground, last, ceiling)) return false
    if (!isTetherKept(state, c.id, footprint)) return false
    if (last && !canRest(state, c, footprint, ground)) return false
    cursor = cell
  }
  return true
}

// combat.tex "Movement" — "jumping": "A jump has a vertical distance equal
// to half the horizontal distance"; it clears only ground lower than that
// above where it sets out (the table's ruling).
function getJumpCeiling(c: Character, from: Placement): number {
  return from.elevation + getMovementSpeed(c, 'jump') / 2
}

function clears(footprint: Coord[], ground: Ground, ceiling: number): boolean {
  return footprint.every((cell) => ground.elevation(cell) < ceiling)
}

function canPass(kind: MoveKind, footprint: Coord[], ground: Ground, lands: boolean, ceiling: number): boolean {
  if (kind === 'jump' && !clears(footprint, ground, ceiling)) return false
  return touchesGround(kind, lands) ? isCrossable(footprint, ground, kind) : !footprint.some(ground.blocked)
}

function withinBudget(cost: ActionCost, budget: number | null): boolean {
  return budget === null || cost.AP <= budget
}

// ---------------------------------------------------------------------------
// Where the move actually ends

// The way a runner is going after `steps` cells of the path: the way the
// last of them went, or null before the first and for any movement but a
// run.
function getRunHeading(state: CombatState, action: MoveAction, steps: number): number | null {
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
// jump, only the cell it lands on.
export function needsBalanceTest(state: CombatState, action: MoveAction): boolean {
  return firstDifficultStep(state, action) !== null
}

function firstDifficultStep(state: CombatState, action: MoveAction): number | null {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!c || !from || !board) return null
  const i = action.path.findIndex((cell, at) =>
    touchesGround(action.movement, at === action.path.length - 1) && getFootprint(c, { ...from, cell }).some((f) => board.terrain[coordKey(f)]?.difficult),
  )
  return i === -1 ? null : i + 1
}

// The DL of the first difficult cell the move enters.
export function getBalanceDL(state: CombatState, action: MoveAction): number {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  const step = firstDifficultStep(state, action)
  if (!c || !from || !board || step === null) return 0
  const cell = action.path[step - 1]
  const DLs = getFootprint(c, { ...from, cell })
    .map((f) => board.terrain[coordKey(f)])
    .filter((t) => t?.difficult)
    .map((t) => t.DL)
  return Math.max(0, ...DLs)
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
// catch's crash too.
export function getMoveOverride(state: CombatState, action: MoveAction): { step: number; stop: 'reaction' | 'jump' | 'trample' } | null {
  const mover = state.characters[action.actorId]
  const starting = action.movement === 'run' && mover ? getMoveBlockCells(mover, 'run', RUN_START_AP) : 0
  for (const { reaction, spawned: strike } of getDrawnOpportunityAttacks(state, action)) {
    if (strike?.kind !== 'strike' || strike.step !== 'done') continue
    const stoppable = (action.movement !== 'run' && action.movement !== 'jump') || reaction.at! - 1 < starting
    const jumped = getReactionsTo(state, strike.id).some((a) => a.kind === 'evasiveJump' && a.actorId === action.actorId)
    if (jumped) return { step: reaction.at! - 1, stop: 'jump' }
    if ((stoppable && getInterruptionOf(strike, action.actorId) !== 'none') || isKnockedDownByHook(state, strike, action.actorId)) return { step: reaction.at! - 1, stop: 'reaction' }
    if (strike.trample?.result === 'blocked') return { step: reaction.at! - 1, stop: 'trample' }
  }
  return null
}

// The path as it will be walked and why it ends where it does: someone
// fleeing it (combat.tex "Flee": the mover stops where the
// flee was triggered, and pays only for the steps walked), an opportunity
// attack that interrupted the mover or that they jumped away from, a target
// who blocked their passage (combat.tex "Crash"), a fall at the first
// difficult cell the test did not clear — whichever comes first. The
// tramples are those on the path as walked.
export function getMoveFacts(state: CombatState, action: MoveAction): MoveFacts {
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
  const difficult = firstDifficultStep(state, action)
  const fell = difficult !== null && difficult <= path.length && action.roll !== null && !isSafeOnDifficultTerrain(action.movement, action.roll.degree)
  if (fell) {
    path = path.slice(0, difficult)
    stop = 'fall'
  }
  return { path, stop, fell, trampled: tramples.trampled.filter((t) => t.at <= path.length + (t.result === 'blocked' ? 1 : 0)) }
}

// ---------------------------------------------------------------------------
// Jumping clear

// The move the character is in the middle of, if an opportunity attack has
// them stood part of the way along one.
function getMoveUnderway(state: CombatState, id: string): MoveAction | null {
  return findOpenRoot(state, 'move', (m) => m.actorId === id && m.step === 'post')
}

// How far along the move underway the character has walked: the step of the
// path they stand on, or 0 at its origin.
function getStepsWalked(state: CombatState, action: MoveAction): number {
  const here = state.board?.placements[action.actorId]?.cell
  const i = here ? action.path.findIndex((cell) => sameCell(cell, here)) : -1
  return i + 1
}

// combat.tex "Movement" — "jumping": "Movement cannot be voluntarily
// interrupted in the middle of a jump." A character hit part of the way
// through a jump cannot jump clear of the attack.
export function isMidJump(state: CombatState, id: string): boolean {
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
// It lands only on ground its vertical reach clears (`getJumpCeiling`). One
// hit mid-jump cannot jump at all.
export function getEvasiveJumpPlacements(state: CombatState, defenderId: string, attackerId: string): Placement[] {
  const defender = state.characters[defenderId]
  const from = state.board?.placements[defenderId]
  const attacker = getPlacedFootprint(state, attackerId)
  const ground = readGround(state, defenderId)
  if (!defender || !from || !attacker || !ground || isMidJump(state, defenderId)) return []
  const underway = getMoveUnderway(state, defenderId)
  const heading = underway ? getRunHeading(state, underway, getStepsWalked(state, underway)) : null
  const before = setDistance(getFootprint(defender, from), attacker)
  const hop = Math.floor(getJumpMovement(defender) / 2)
  const leap = heading === null ? hop : Math.max(hop, Math.floor(getRunningJumpMovement(defender)))
  const reaches = (cell: Coord) => distance(cell, from.cell) <= hop || (heading !== null && isWithinCone(subtract(cell, from.cell), heading))
  const placements: Placement[] = []
  for (const cell of disk(from.cell, leap)) {
    if (sameCell(cell, from.cell) || !reaches(cell)) continue
    for (const orientation of ROTATIONS) {
      const to = { ...from, cell, orientation }
      const footprint = getFootprint(defender, to)
      if (!footprint.some(ground.blocked) && clears(footprint, ground, getJumpCeiling(defender, from)) && canRest(state, defender, footprint, ground) && setDistance(footprint, attacker) > before) placements.push(to)
    }
  }
  return placements
}

export function hasJumpSpace(state: CombatState, defenderId: string, attackerId: string): boolean {
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
// not rest on are walked through and left out.
export function getReachableCells(state: CombatState, action: MoveAction): ReachableCell[] {
  const { actorId, movement: kind } = action
  const c = state.characters[actorId]
  const from = state.board?.placements[actorId]
  const ground = readGround(state, actorId)
  if (!c || !from || !ground || isPosture(kind)) return []
  if (!getMovementOptions(state, c, action).find((o) => o.kind === kind)?.available) return []

  const affordable = (steps: number) => {
    return canAfford(c, getMovePrice(c, action, steps)) && withinBudget(getMoveCost(c, kind, steps), action.budget)
  }
  const ceiling = getJumpCeiling(c, from)
  const enter = (cell: Coord) => canPass(kind, getFootprint(c, { ...from, cell }), ground, false, ceiling)
  return walkOut(from.cell, affordable, enter)
    .filter(({ cell }) => {
      const footprint = getFootprint(c, { ...from, cell })
      return isCrossable(footprint, ground, kind) && canRest(state, c, footprint, ground)
    })
    .map(({ cell, steps, path }) => ({ cell, steps, cost: getMovePrice(c, action, steps), path }))
}
