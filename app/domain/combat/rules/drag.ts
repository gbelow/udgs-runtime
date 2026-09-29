import type { Action, CombatState, Coord, DragAction, DragFacts, Placement, PushMovement } from '../types'
import type { CampaignCharacter } from '../../types'
import { ASSIST } from '../../tables'
import { PUSH_MOVEMENTS } from '../../lists'
import { getForce } from '../../character/rules/skills'
import { hasAffliction } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { Term, sumTerms } from '../../character/rules/terms'
import { DIRECTIONS, add, directionTo, sameCell, setDistance, walkOut } from '../geometry'
import { getFootprint, placeAt, withPlacements } from './board'
import { getOpeningReaction, getReactionsTo } from './log'
import { getPartners, isHeld, getGrappleGroup } from './partners'
import { getFightName } from './fighters'
import { getMoveBlockCells, getMoveCost, isLameBarred } from './move'
import { canStandAt } from './ground'
import { getInterruptions } from './interruption'
import { dropHolders } from './grapple'

// ---------------------------------------------------------------------------
// Push and drag: who is on which side

// combat.tex "Push and drag": everyone locked in the grapple with the actor
// answers the block, each as they chose — helping the actor, tagging along
// on neither side, or, held by nobody, letting go and leaving the grapple.
// Everyone else stays put on the other side, whether they spend on it
// (`resist`) or not: one who does not answer, or has no AP left to move,
// counts there at their Force ("help the losing side passively, which
// prevents any movement").
type Parties = {
  // everyone in the group once whoever let go has, the actor included
  movers: string[]
  attackers: string[]
  resisters: string[]
  carriers: string[]
  released: string[]
}

function getParties(state: CombatState, root: DragAction): Parties {
  const reactions = getReactionsTo(state, root.id)
  const chose = (kind: Action['kind']) => new Set(reactions.filter((r) => r.kind === kind).map((r) => r.actorId))
  const [assist, carry, letGo] = [chose('assist'), chose('carry'), chose('letGo')]
  const released = [...letGo].filter((id) => !isHeld(state.grapples, id))
  const grapples = dropHolders(state.grapples, (id) => released.includes(id))
  const movers = getGrappleGroup(grapples, root.actorId)
  const attackers = movers.filter((id) => id === root.actorId || assist.has(id))
  const carriers = movers.filter((id) => carry.has(id) && !attackers.includes(id))
  const resisters = movers.filter((id) => !attackers.includes(id) && !carriers.includes(id))
  return { movers, attackers, resisters, carriers, released }
}

// "It is possible to spend 2 AP to gain 5 force in one comparison": the
// actor as declared, a helper who chose to, a defender by resisting.
const BOOST = 5

function wantsBoost(state: CombatState, root: DragAction, id: string): boolean {
  if (id === root.actorId) return root.boost
  return getReactionsTo(state, root.id).some((r) => r.actorId === id && ((r.kind === 'assist' && r.boost) || r.kind === 'resist'))
}

// combat.tex "Push and drag": "Use the same rules for multiple characters as
// grapple, but use force instead of grapple as skill" — combat.tex
// "Grapple": "the highest skill value among them plus 3/2/1 for each
// additional character, up to a maximum of 5 ... Characters with force 5
// points lower than their opponent always add just +1". Each value is the
// Force with its +5 if it counts, and the opponent is the strongest of the
// other side so reckoned (the table's ruling).
type SideValue = { id: string; value: number; label: string }

function sideTerms(values: SideValue[], opponent: number): Term[] {
  if (values.length === 0) return []
  const lead = values.reduce((best, v) => (v.value > best.value ? v : best))
  const others = values.filter((v) => v.id !== lead.id)
  const bonus = Math.min(ASSIST.max, others.reduce((sum, v, i) => {
    const weaker = v.value <= opponent - ASSIST.weakerBy
    return sum + (weaker ? ASSIST.weaker : ASSIST.bonus[Math.min(i, ASSIST.bonus.length - 1)])
  }, 0))
  return [{ label: lead.label, value: lead.value }, ...(bonus > 0 ? [{ label: 'help', value: bonus }] : [])]
}

function strongest(values: SideValue[]): number {
  return Math.max(-Infinity, ...values.map((v) => v.value))
}

type Comparison = { attacker: Term[]; defender: Term[] | null; diff: number }

function compare(state: CombatState, parties: Parties, boosted: ReadonlySet<string>): Comparison {
  const value = (id: string): SideValue => {
    const c = state.characters[id]
    const up = boosted.has(id)
    return { id, value: (c ? getForce(c) : 0) + (up ? BOOST : 0), label: `${getFightName(state, id)} force${up ? ` +${BOOST}` : ''}` }
  }
  const pushing = parties.attackers.map(value)
  const resisting = parties.resisters.map(value)
  const attacker = sideTerms(pushing, strongest(resisting))
  const defender = resisting.length === 0 ? null : sideTerms(resisting, strongest(pushing))
  return { attacker, defender, diff: defender === null ? Infinity : sumTerms(attacker) - sumTerms(defender) }
}

// combat.tex "Push and drag": "Having higher force allows moving forwards or
// backwards with careful movement speed"; "A force difference smaller than
// 5 allows moving around the grapple with basic movement ... A greater
// difference allows that only for the stronger character"; "It is possible
// to run and jump when force is 10 higher than the opponent."
const CIRCLE_GAP = 5
const RUN_LEAD = 10

export function isPushAllowed(movement: PushMovement, diff: number): boolean {
  switch (movement) {
    case 'careful': return diff > 0
    case 'basic': return diff > -CIRCLE_GAP
    case 'run': return diff >= RUN_LEAD
  }
}

// combat.tex "Push and drag": "the losing side must decide first to spend or
// not". The side the comparison goes against with nobody's +5 decides
// first; the other side's +5 counts only if that turned the comparison
// against them. A +5 declared by a side that never had to answer is neither
// counted nor paid.
function getBoosted(state: CombatState, root: DragAction, parties: Parties): string[] {
  const allowed = (boosted: string[]) => isPushAllowed(root.movement, compare(state, parties, new Set(boosted)).diff)
  const pushers = parties.attackers.filter((id) => wantsBoost(state, root, id))
  const stayers = parties.resisters.filter((id) => wantsBoost(state, root, id))
  const before = allowed([])
  const [first, second] = before ? [stayers, pushers] : [pushers, stayers]
  return allowed(first) === before ? first : [...first, ...second]
}

export type DragSides = Parties & {
  boosted: string[]
  attacker: Term[]
  // null: nobody stays put against it
  defender: Term[] | null
  // whether the block may be moved as declared
  allowed: boolean
}

export function getDragSides(state: CombatState, root: DragAction): DragSides {
  const parties = getParties(state, root)
  if (root.compared) return { ...parties, ...root.compared }
  const boosted = getBoosted(state, root, parties)
  const { attacker, defender, diff } = compare(state, parties, new Set(boosted))
  return { ...parties, boosted, attacker, defender, allowed: isPushAllowed(root.movement, diff) }
}

// The comparison as it stands now, to be written on the push when it is
// paid for: from then on its outcome is read off what was written.
export function getDragComparison(state: CombatState, root: DragAction): NonNullable<DragAction['compared']> {
  const { attacker, defender, boosted, allowed } = getDragSides(state, { ...root, compared: null })
  return { attacker, defender, boosted, allowed }
}

// ---------------------------------------------------------------------------
// Prices

const FREE: ActionCost = { AP: 0, STA: 0 }

// Whether the character walks the block: the actor always, and on a push
// along the line everyone who helps or tags along; circling moves the
// actor alone ("as long as no other grapplers are displaced").
function walksBlock(root: DragAction, action: Pick<Action, 'kind' | 'actorId'>): boolean {
  if (action.kind === 'drag') return true
  return root.movement !== 'basic' && (action.kind === 'assist' || action.kind === 'carry')
}

// What the block costs whoever takes part in it: "2 AP to gain 5 force"
// for one whose +5 counted, and the metres of the block for one who walks
// them, once the comparison lets it move. `action` is the push itself or an
// answer to it.
export function getPushPrice(state: CombatState, root: DragAction, action: Pick<Action, 'kind' | 'actorId'>): ActionCost {
  const c = state.characters[action.actorId]
  if (!c) return FREE
  const sides = getDragSides(state, root)
  const boost = sides.boosted.includes(action.actorId) ? getActionCost(c, 'pushBoost') : FREE
  const walk = sides.allowed && walksBlock(root, action) ? getMoveCost(c, root.movement, root.path.length) : FREE
  return { AP: boost.AP + walk.AP, STA: boost.STA + walk.STA }
}

// What answering the block could cost at most, the +5 counted and the block
// moved: what an answer has to be able to pay to be open.
export function getPushAnswerCost(state: CombatState, root: DragAction, action: Pick<Action, 'kind' | 'actorId'> & { boost?: boolean }): ActionCost {
  const c = state.characters[action.actorId]
  if (!c) return FREE
  const boost = action.kind === 'resist' || action.boost ? getActionCost(c, 'pushBoost') : FREE
  const walk = walksBlock(root, action) ? getMoveCost(c, root.movement, Math.max(1, root.path.length)) : FREE
  return { AP: boost.AP + walk.AP, STA: boost.STA + walk.STA }
}

// ---------------------------------------------------------------------------
// Moving the block

// combat.tex "Push and drag": the comparison "is repeated for every 2 AP
// worth of movement" — a block is as many cells as 2 AP buys at its speed.
const BLOCK_AP = 2

// combat.tex "Lame": "Cannot run ... or use basic movement".
export type PushMovementOption = { kind: PushMovement; available: boolean; reason: string | null }

export function getPushMovements(c: CampaignCharacter): PushMovementOption[] {
  const lame = hasAffliction(c, 'lame')
  return PUSH_MOVEMENTS.map((kind) => {
    const reason = lame && isLameBarred(kind) ? 'lame' : null
    return { kind, available: reason === null, reason }
  })
}

// "forwards or backwards": along the line from the actor through the target.
function getAxis(state: CombatState, root: DragAction): Coord | null {
  const from = state.board?.placements[root.actorId]
  const to = root.targetId ? state.board?.placements[root.targetId] : undefined
  return from && to ? DIRECTIONS[directionTo(from.cell, to.cell)] : null
}

function scale(d: Coord, n: number): Coord {
  return { q: d.q * n, r: d.r * n }
}

function blockCells(state: CombatState, root: DragAction): number {
  const c = state.characters[root.actorId]
  return c ? Math.floor(getMoveBlockCells(c, root.movement, BLOCK_AP)) : 0
}

function canGroupStand(state: CombatState, placements: Record<string, Placement>): boolean {
  const moved = withPlacements(state, placements)
  return Object.entries(placements).every(([id, p]) => canStandAt(moved, id, p))
}

// Circling: the actor stepping on around the grapple, somewhere they may
// stand still touching every partner, nobody else moved.
function circledTo(state: CombatState, root: DragAction, cell: Coord): Record<string, Placement> | null {
  const board = state.board
  const from = board?.placements[root.actorId]
  const c = state.characters[root.actorId]
  if (!board || !from || !c) return null
  const to = placeAt(board, from, cell)
  const footprint = getFootprint(c, to)
  const touching = getPartners(state, root.actorId).every((id) => {
    const partner = state.characters[id]
    const at = board.placements[id]
    return !partner || !at || setDistance(footprint, getFootprint(partner, at)) <= 1
  })
  return touching && canStandAt(state, root.actorId, to) ? { [root.actorId]: to } : null
}

// Along the line: everyone moving with the group shifted as far as the
// actor has gone, if everyone can stand there.
function shiftedTo(state: CombatState, root: DragAction, movers: string[], cell: Coord): Record<string, Placement> | null {
  const board = state.board
  const from = board?.placements[root.actorId]
  if (!board || !from) return null
  const offset = { q: cell.q - from.cell.q, r: cell.r - from.cell.r }
  const placements = Object.fromEntries(movers.flatMap((id) => {
    const p = board.placements[id]
    return p ? [[id, placeAt(board, p, add(p.cell, offset))]] : []
  }))
  return canGroupStand(state, placements) ? placements : null
}

// Where everyone who moves stands after each step of the actor's way; null
// when the way is not one the block allows — longer than the block, off the
// line, or somewhere someone cannot stand.
export function getGroupSteps(state: CombatState, root: DragAction): Record<string, Placement>[] | null {
  const from = state.board?.placements[root.actorId]
  if (!from || root.path.length > blockCells(state, root)) return null
  if (root.movement === 'basic') {
    const steps: Record<string, Placement>[] = []
    for (const cell of root.path) {
      const at = circledTo(withPlacements(state, steps.at(-1) ?? {}), root, cell)
      if (!at) return null
      steps.push(at)
    }
    return steps
  }
  if (root.path.length === 0) return []
  const axis = getAxis(state, root)
  const direction = axis ? [axis, scale(axis, -1)].find((d) => sameCell(add(from.cell, d), root.path[0])) : undefined
  if (!direction) return null
  const { movers } = getParties(state, root)
  const steps: Record<string, Placement>[] = []
  for (const [i, cell] of root.path.entries()) {
    const at = sameCell(cell, add(from.cell, scale(direction, i + 1))) ? shiftedTo(state, root, movers, cell) : null
    if (!at) return null
    steps.push(at)
  }
  return steps
}

// Where everyone who moves with the block set out from.
export function getGroupOrigin(state: CombatState, root: DragAction): Record<string, Placement> {
  const board = state.board
  const ids = root.movement === 'basic' ? [root.actorId] : getParties(state, root).movers
  return Object.fromEntries(ids.flatMap((id) => (board?.placements[id] ? [[id, board.placements[id]]] : [])))
}

// Every cell the actor can take the block to at its speed, with the way
// there: around the grapple, or straight forwards or backwards.
export function getDragReach(state: CombatState, root: DragAction): { cell: Coord; steps: number; path: Coord[] }[] {
  const from = state.board?.placements[root.actorId]
  if (!from) return []
  const block = blockCells(state, root)
  if (root.movement === 'basic') {
    return walkOut(from.cell, (steps) => steps <= block, (_cell, path) => getGroupSteps(state, { ...root, path }) !== null)
  }
  const axis = getAxis(state, root)
  if (!axis) return []
  return [axis, scale(axis, -1)].flatMap((d) => {
    const reach: { cell: Coord; steps: number; path: Coord[] }[] = []
    for (let n = 1; n <= block; n++) {
      const path = Array.from({ length: n }, (_, i) => add(from.cell, scale(d, i + 1)))
      if (getGroupSteps(state, { ...root, path }) === null) break
      reach.push({ cell: path[n - 1], steps: n, path })
    }
    return reach
  })
}

// Where the block was brought to a stop: nowhere when the comparison does
// not let it move; one step short of the stretch on which a third party's
// attack stunned the actor, where everyone stays, as an interrupted mover
// does. The table's ruling: like running and jumping it carries on through
// an interruption, and only a stun of the actor stops it. Null while it
// goes on.
export function getPushStop(state: CombatState, root: DragAction): number | null {
  if (!getDragSides(state, root).allowed) return 0
  const stunned = getInterruptions(state, root).find(({ level }) => level === 'stunned')
  const reaction = stunned ? getOpeningReaction(state, stunned.by) : null
  return reaction ? Math.max(0, (reaction.at ?? 1) - 1) : null
}

// What the block came to: who let go instead of being moved, how far it
// went, and where everyone who moved ended.
export function getDragFacts(state: CombatState, root: DragAction): DragFacts {
  const stop = getPushStop(state, root)
  const steps = getGroupSteps(state, root) ?? []
  const walked = stop === null ? steps : steps.slice(0, stop)
  return { released: getParties(state, root).released, steps: walked.length, to: walked.at(-1) ?? {} }
}
