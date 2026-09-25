import type { CampaignCharacter, Character, MoveKind, MovementKind, Posture } from '../../types'
import type { CombatState, Coord, Degree, MoveAction, MoveFacts, Placement } from '../types'
import { MOVEMENT_BLOCK_COST } from '../../tables'
import { MOVEMENT_KINDS, POSTURES } from '../../lists'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getAfflictions } from '../../character/rules/afflictions'
import { getBalanceTerms } from '../../character/rules/skills'
import { Term } from '../../character/rules/terms'
import { getBasicMovement, getCarefulMovement, getCrawlMovement, getJumpMovement, getRunMovement, getRunningJumpMovement, getStandMovement, getSwimMovement } from '../../character/rules/movement'
import { getSize } from '../../character/rules/misc'
import { DIRECTIONS, coordKey, directionTo, disk, distance, neighbors, sameCell, setDistance, subtract } from '../geometry'
import { getFootprint, getOccupancy, getPlacedFootprint, placeAt } from './board'
import { getMoveTramples } from './trample'
import { isImmobile, isInGrapple } from './grapple'
import { getDrawnOpportunityAttacks, type DrawnOpportunityAttack } from './opportunity'

// How a character crosses the board: what each kind of movement costs it,
// which kinds it may use from where it stands, whether a declared path is
// one it can walk, and where it could get to.

// Where the move sets out from: the placement the commit wrote down, or
// while it is still being declared, where the actor stands.
export function getMoveOrigin(state: CombatState, action: MoveAction): Placement | undefined {
  return action.from ?? state.board?.placements[action.actorId]
}

// ---------------------------------------------------------------------------
// Price

// combat.tex "Movement Costs and Speeds": metres per block of the kind.
export function getMovementSpeed(c: Character, kind: MovementKind): number {
  switch (kind) {
    case 'careful': return getCarefulMovement(c)
    case 'basic': return getBasicMovement(c)
    case 'run': return getRunMovement(c)
    case 'jump': return getJumpMovement(c)
    case 'crawl': return getCrawlMovement(c)
    case 'swim': return getSwimMovement(c)
  }
}

// combat.tex "Movement": "moving only a fraction of a space is impossible",
// so a move is bought in whole blocks, as many as cover the cells. A speed
// is printed to two places (0.33 for a third), so the quotient is read to a
// tenth before it is rounded up, or a third of a metre three times would
// cost a fourth block.
// How many cells of a movement the given AP buys, whole blocks only.
function getMoveBlockCells(c: Character, kind: MovementKind, AP: number): number {
  return Math.floor(AP / MOVEMENT_BLOCK_COST[kind].AP) * getMovementSpeed(c, kind)
}

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

// combat.tex "Movement Costs and Speeds": "Stand up & 5 -AGI/5 AP"; going
// prone is free.
function getPostureCost(c: Character, posture: Posture): ActionCost {
  return posture === 'stand' ? { AP: getStandMovement(c), STA: 0 } : { AP: 0, STA: 0 }
}

// What the move as declared costs its actor, less what the reaction that
// opened it already paid (combat.tex "Evasion": the reflex's AP "is used to
// move and does not need to be spent again, but any STA cost must be paid"),
// plus what that reaction asks on top (combat.tex "Avoiding an Explosion":
// "can run by spending one extra STA").
export function getMovePrice(c: Character, action: MoveAction, cells: number): ActionCost {
  const cost = getMoveCost(c, action.movement, cells)
  const surcharge = (action.surchargedMovements as readonly MoveKind[]).includes(action.movement) ? action.surcharge : { AP: 0, STA: 0 }
  return { AP: Math.max(0, cost.AP - action.prepaid) + surcharge.AP, STA: cost.STA + surcharge.STA }
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

function isInLiquid(state: CombatState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  return !!placement && getFootprint(c, placement).some((cell) => state.board?.terrain[coordKey(cell)]?.liquid)
}

// combat.tex "Movement": crawling "is the only usable movement speed while
// prone", swimming "the only usable movement speed while swimming", running
// "can only be initiated during a movement surge" (combat.tex "Action
// surge": the surge allows "running until the end of the turn"). A move a
// reaction opened may name the kinds it grants instead, a run among them
// without the surge (combat.tex "Avoiding an Explosion": on a critical "the
// character can run"). combat.tex "Grappled": "Movement requires pushing or
// dragging the other participants in the grapple" — circling within the
// grapple area is a push's choice too (combat.tex "Push and drag"); they get
// up by escaping ("Escape is also used for trying to stand up while
// grappled"); "Immobile: Cannot move".
export function getMovementOptions(state: CombatState, c: CampaignCharacter, action?: MoveAction): MovementOption[] {
  const prone = getAfflictions(c).includes('prone')
  const swimming = isInLiquid(state, c)
  const granted = action?.movements ?? null
  const held = isInGrapple(state, c.id)
  const immobile = isImmobile(c)
  const moves = MOVEMENT_KINDS.map((kind): MovementOption => {
    const gate = immobile ? { available: false, reason: 'immobile' }
      : held ? { available: false, reason: 'grappled: push or drag instead' }
      : movementGate(kind, prone, swimming, c.usedSurge === 'movement', granted)
    return { kind, speed: getMovementSpeed(c, kind), block: MOVEMENT_BLOCK_COST[kind], ...gate }
  })
  // standing up and going prone, for a move of the character's own: one a
  // reaction opened is the movement the reaction grants
  const postures = POSTURES.map((kind): MovementOption => {
    const reason = immobile ? 'immobile' : held && kind === 'stand' ? 'grappled: escape to stand up' : granted !== null ? 'not what the reaction allows' : kind === 'stand' ? (prone ? null : 'not prone') : prone ? 'already prone' : null
    return { kind, speed: 0, block: getPostureCost(c, kind), available: reason === null, reason }
  })
  return [...moves, ...postures]
}

function movementGate(kind: MovementKind, prone: boolean, swimming: boolean, surged: boolean, granted: MovementKind[] | null): { available: boolean; reason: string | null } {
  if (granted !== null && !granted.includes(kind)) return { available: false, reason: 'not what the reaction allows' }
  if (swimming && kind !== 'swim') return { available: false, reason: 'swimming' }
  if (!swimming && kind === 'swim') return { available: false, reason: 'not in water' }
  if (prone && kind !== 'crawl') return { available: false, reason: 'prone' }
  if (kind === 'run' && granted === null && !surged) return { available: false, reason: 'needs a movement surge' }
  return { available: true, reason: null }
}

// ---------------------------------------------------------------------------
// Where a footprint may stand

// creating.tex "Size and Space Occupation": "Two creatures of size 3 can
// occupy the same space, but cannot end a turn like that. A creature can
// occupy the same space as another of two sizes higher than itself." A
// footprint may be walked through anyone's cells but may only come to rest
// on cells free of everyone within a size of it.
type Ground = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  sharedBy: (cell: Coord) => string[]
}

function readGround(state: CombatState, mover: string): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  return {
    blocked: (cell) => !!board.terrain[coordKey(cell)]?.blocking,
    liquid: (cell) => !!board.terrain[coordKey(cell)]?.liquid,
    sharedBy: (cell) => (occupancy[coordKey(cell)] ?? []).filter((id) => id !== mover),
  }
}

function canRest(state: CombatState, c: Character, footprint: Coord[], ground: Ground): boolean {
  return footprint.every((cell) =>
    ground.sharedBy(cell).every((id) => {
      const other = state.characters[id]
      return other !== undefined && Math.abs(getSize(other) - getSize(c)) >= 2
    }),
  )
}

// Whether the move as declared is one its actor can make: every step a
// neighbour of the last, every footprint along the way off blocking cells
// and in the water exactly when swimming, and the last one somewhere it may
// come to rest.
export function isPathLegal(state: CombatState, action: MoveAction): boolean {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const ground = readGround(state, action.actorId)
  if (!c || !getMovementOptions(state, c, action).find((o) => o.kind === action.movement)?.available) return false
  if (isPosture(action.movement)) return action.path.length === 0
  if (!from || !ground || action.path.length === 0) return false
  if (!withinBudget(getMoveCost(c, action.movement, action.path.length), action.budget)) return false

  let cursor = from.cell
  for (const [i, cell] of action.path.entries()) {
    if (distance(cursor, cell) !== 1) return false
    const last = i === action.path.length - 1
    const orientation = last && action.orientation !== null ? action.orientation : from.orientation
    const footprint = getFootprint(c, { ...from, cell, orientation })
    if (footprint.some(ground.blocked)) return false
    if (footprint.some(ground.liquid) !== (action.movement === 'swim')) return false
    if (last && !canRest(state, c, footprint, ground)) return false
    cursor = cell
  }
  // combat.tex "Trample": the opponent "moves back one space" — not
  // possible against a blocked cell, so neither is the path (the table's
  // ruling)
  return !getMoveTramples(state, action, action.path).blocked
}

function withinBudget(cost: ActionCost, budget: number | null): boolean {
  return budget === null || cost.AP <= budget
}

// ---------------------------------------------------------------------------
// Where the move actually ends

// combat.tex "running": "can continue running ... as long as no turns of 90
// degrees or more are made per running block". Within a block (one running
// speed of cells) the heading may stray one hex step (60 degrees) from the
// block's first step; the path is cut where it would turn harder, and the
// runner stops there. The table's ruling: turning while running stops the
// move, and the path may still be drawn past it.
export function getRunPath(state: CombatState, action: MoveAction): Coord[] {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  if (!c || !from || action.movement !== 'run') return action.path
  const block = Math.max(1, Math.floor(getMovementSpeed(c, 'run')))
  let cursor = from.cell
  let heading = 0
  for (const [i, cell] of action.path.entries()) {
    const direction = directionTo(cursor, cell)
    if (i % block === 0) heading = direction
    else if (!isWithinRunTurn(heading, direction)) return action.path.slice(0, i)
    cursor = cell
  }
  return action.path
}

function isWithinRunTurn(heading: number, direction: number): boolean {
  return Math.min((direction - heading + 6) % 6, (heading - direction + 6) % 6) <= 1
}

// The heading a runner is held to after `steps` cells of the path: that of
// the running block those steps are in, or null at the start of a block,
// where the next step sets a new one, and for any movement but a run.
function getRunHeading(state: CombatState, action: MoveAction, steps: number): number | null {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  if (!c || !from || action.movement !== 'run') return null
  const block = Math.max(1, Math.floor(getMovementSpeed(c, 'run')))
  if (steps % block === 0) return null
  let cursor = from.cell
  let heading = 0
  for (const [i, cell] of action.path.slice(0, steps).entries()) {
    if (i % block === 0) heading = directionTo(cursor, cell)
    cursor = cell
  }
  return heading
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
// move whose path enters a difficult cell is committed by a die.
export function needsBalanceTest(state: CombatState, action: MoveAction): boolean {
  return firstDifficultStep(state, action) !== null
}

function firstDifficultStep(state: CombatState, action: MoveAction): number | null {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  if (!c || !from || !board) return null
  const i = getRunPath(state, action).findIndex((cell) =>
    getFootprint(c, { ...from, cell }).some((f) => board.terrain[coordKey(f)]?.difficult),
  )
  return i === -1 ? null : i + 1
}

export function getBalanceTestTerms(c: Character): Term[] {
  return getBalanceTerms(c)
}

// The DL of the first difficult cell the move enters.
export function getBalanceDL(state: CombatState, action: MoveAction): number {
  const c = state.characters[action.actorId]
  const from = getMoveOrigin(state, action)
  const board = state.board
  const step = firstDifficultStep(state, action)
  if (!c || !from || !board || step === null) return 0
  const cell = getRunPath(state, action)[step - 1]
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
export function isSafeOnDifficultTerrain(kind: MoveKind, degree: Degree): boolean {
  switch (degree) {
    case 'critical': return true
    case 'hit': return kind !== 'run' && kind !== 'jump'
    case 'graze': return kind === 'careful' || kind === 'crawl' || kind === 'swim'
    case 'miss': return kind === 'crawl'
  }
}

// combat.tex "Opportunity Attack": the ones declared against the move, in
// the order the mover comes to them.
export function getOpportunityAttacks(state: CombatState, action: MoveAction): DrawnOpportunityAttack[] {
  return getDrawnOpportunityAttacks(state, action)
    .filter(({ reaction }) => reaction.at !== null)
    .sort((a, b) => a.reaction.at! - b.reaction.at!)
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
// combat.tex "Trip": a mover who "falls and is prone" goes no further,
// running or not. combat.tex "Trample": "If the defender's force is equal
// or higher, the runner is stopped" — by a braced blow's trample too.
export function getMoveOverride(state: CombatState, action: MoveAction): { step: number; stop: 'reaction' | 'jump' | 'trample' } | null {
  const mover = state.characters[action.actorId]
  const starting = action.movement === 'run' && mover ? getMoveBlockCells(mover, 'run', 2) : 0
  for (const { reaction, spawned: strike } of getOpportunityAttacks(state, action)) {
    if (strike?.kind !== 'strike' || strike.status !== 'resolved') continue
    const stoppable = (action.movement !== 'run' && action.movement !== 'jump') || reaction.at! - 1 < starting
    const jumped = state.actions.some((a) => a.reactionTo === strike.id && a.kind === 'evasiveJump' && a.actorId === action.actorId)
    if (jumped) return { step: reaction.at! - 1, stop: 'jump' }
    if ((stoppable && strike.interruption !== 'none') || strike.tripped) return { step: reaction.at! - 1, stop: 'reaction' }
    if (strike.trample?.result === 'stopped') return { step: reaction.at! - 1, stop: 'trample' }
  }
  return null
}

// The path as it will be walked and why it ends where it does: a run cut at
// a turn, an opportunity attack that interrupted the mover or that they
// jumped away from, a resister who stopped them (combat.tex "Movement" —
// "trample"), a fall at the first difficult cell the test did not clear —
// whichever comes first. The tramples are those on the path as walked.
export function getMoveFacts(state: CombatState, action: MoveAction): MoveFacts {
  const run = getRunPath(state, action)
  let path = run
  let stop: MoveFacts['stop'] = run.length < action.path.length ? 'turn' : 'end'
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
  return { path, stop, fell, trampled: tramples.trampled.filter((t) => t.at <= path.length + (t.result === 'stopped' ? 1 : 0)) }
}

// Where the mover stands part of the way along the move: the anchor at that
// step, as oriented when they set out. Null at step 0, where they have not
// left the origin.
export function getMoveWaypoint(state: CombatState, action: MoveAction, steps: number): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = action.path[steps - 1]
  if (!from || !cell || steps <= 0) return null
  return placeAt(state.board, from, cell)
}

// How the step into the `at`th cell of the move changes the mover's distance
// to someone: below zero towards them, above away from them.
export function getStepDelta(state: CombatState, action: MoveAction, at: number, otherId: string): number | null {
  const mover = state.characters[action.actorId]
  const other = getPlacedFootprint(state, otherId)
  const before = at <= 1 ? getMoveOrigin(state, action) : getMoveWaypoint(state, action, at - 1)
  const after = getMoveWaypoint(state, action, at)
  if (!mover || !other || !before || !after) return null
  return setDistance(getFootprint(mover, after), other) - setDistance(getFootprint(mover, before), other)
}

// combat.tex "Hook Attack": a runner stepping away from the attacker (the
// step the hook's reaction fires on).
export function isHookedRunner(state: CombatState, action: MoveAction, at: number, attackerId: string): boolean {
  return action.movement === 'run' && (getStepDelta(state, action, at, attackerId) ?? 0) > 0
}

// Where the move ends: the last cell of the path as walked, the orientation
// it named, the elevation of the ground there — the board's terrain says how
// high a cell is, so a placement carried in from a VTT is re-read off it on
// the first move.
export function getMoveDestination(state: CombatState, action: MoveAction, path: Coord[]): Placement | null {
  const from = getMoveOrigin(state, action)
  const cell = path[path.length - 1]
  if (!from || !cell) return null
  return { ...placeAt(state.board, from, cell), orientation: action.orientation ?? from.orientation }
}

// ---------------------------------------------------------------------------
// Jumping clear

// The move the character is in the middle of, if an opportunity attack has
// them stood part of the way along one.
function getMoveUnderway(state: CombatState, id: string): MoveAction | null {
  const move = state.actions.find((a) => a.kind === 'move' && a.actorId === id && a.reactionTo === null && a.status === 'rolled')
  return move?.kind === 'move' ? move : null
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
// orientation, whose footprint stands on free ground and ends at least one
// cell further from the attacker than it began. A runner hit mid-block may
// jump any way, but within a hex step of the block's heading the jump is a
// forward one out of the run and reaches the running long jump ("jumping":
// "If performed during a run ... match that of running"); the table's
// ruling. One hit mid-jump cannot jump at all.
export function getEvasiveJumpPlacements(state: CombatState, defenderId: string, attackerId: string): Placement[] {
  const board = state.board
  const defender = state.characters[defenderId]
  const from = board?.placements[defenderId]
  const attacker = getPlacedFootprint(state, attackerId)
  if (!board || !defender || !from || !attacker || isMidJump(state, defenderId)) return []
  const underway = getMoveUnderway(state, defenderId)
  const heading = underway ? getRunHeading(state, underway, getStepsWalked(state, underway)) : null
  const before = setDistance(getFootprint(defender, from), attacker)
  const taken = new Set(
    Object.entries(getOccupancy(board, state.characters))
      .filter(([, ids]) => ids.some((id) => id !== defenderId))
      .map(([key]) => key),
  )
  const free = (cell: Coord) => !taken.has(coordKey(cell)) && !board.terrain[coordKey(cell)]?.blocking
  const hop = Math.floor(getJumpMovement(defender) / 2)
  const leap = heading === null ? hop : Math.max(hop, Math.floor(getRunningJumpMovement(defender)))
  const reaches = (cell: Coord) => distance(cell, from.cell) <= hop || (heading !== null && isWithinCone(subtract(cell, from.cell), heading))
  const placements: Placement[] = []
  for (const cell of disk(from.cell, leap)) {
    if (sameCell(cell, from.cell) || !reaches(cell)) continue
    for (let orientation = 0; orientation < 6; orientation++) {
      const to = { ...from, cell, orientation }
      const footprint = getFootprint(defender, to)
      if (footprint.every(free) && setDistance(footprint, attacker) > before) placements.push(to)
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
  const crossable = (cell: Coord) => {
    const footprint = getFootprint(c, { ...from, cell })
    return !footprint.some(ground.blocked) && footprint.some(ground.liquid) === (kind === 'swim')
  }

  const seen = new Set([coordKey(from.cell)])
  const reachable: ReachableCell[] = []
  let frontier: { cell: Coord; path: Coord[] }[] = [{ cell: from.cell, path: [] }]
  for (let steps = 1; frontier.length > 0; steps++) {
    if (!affordable(steps)) break
    const cost = getMovePrice(c, action, steps)
    const next: typeof frontier = []
    for (const { cell, path } of frontier) {
      for (const n of neighbors(cell)) {
        const key = coordKey(n)
        if (seen.has(key) || !crossable(n)) continue
        seen.add(key)
        const walked = [...path, n]
        if (getMoveTramples(state, { ...action, path: walked }, walked).blocked) continue
        next.push({ cell: n, path: walked })
        if (canRest(state, c, getFootprint(c, { ...from, cell: n }), ground)) reachable.push({ cell: n, steps, cost, path: walked })
      }
    }
    frontier = next
  }
  return reachable
}

export function findReachable(cells: ReachableCell[], cell: Coord): ReachableCell | null {
  return cells.find((r) => sameCell(r.cell, cell)) ?? null
}

// Whether a footprint may be put down here outside of any move: off
// blocking cells and free of everyone within a size. What a placement by
// hand has to respect.
export function canStandAt(state: CombatState, id: string, placement: Placement): boolean {
  const c = state.characters[id]
  const ground = readGround(state, id)
  if (!c || !ground) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(ground.blocked) && canRest(state, c, footprint, ground)
}

// The path a click on a cell turns the declared one into: the cell taken
// back if it is the path's end, one more step if it is next to the end,
// the shortest way there if it is reachable at all, and nothing otherwise.
export function pickPathCell(state: CombatState, action: MoveAction, cell: Coord): Coord[] | null {
  const from = getMoveOrigin(state, action)
  if (!from) return null
  const end = action.path[action.path.length - 1] ?? from.cell
  if (action.path.length > 0 && sameCell(end, cell)) return action.path.slice(0, -1)
  const reachable = getReachableCells(state, action)
  const there = findReachable(reachable, cell)
  if (!there) return null
  if (distance(end, cell) === 1 && there.steps > action.path.length) return [...action.path, cell]
  return there.path
}
