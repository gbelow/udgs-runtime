import type { Character } from '../../types'
import type { Action, CombatState, Coord, DisplaceAction, DisplaceFacts, DragAction, DragFacts, Grapple, Placement } from '../types'
import { ASSIST } from '../../tables'
import { getForce } from '../../character/rules/skills'
import { getSize } from '../../character/rules/misc'
import { Term, sumTerms } from '../../character/rules/terms'
import { isMeleeRange } from '../../weaponProperties'
import { DIRECTIONS, add, sameCell, setDistance, walkOut } from '../geometry'
import { getFootprint, getPlacedFootprint, getReach, placeAt, withPlacements } from './board'
import { getOpeningReaction, getReactionsTo } from './log'
import { getGrapplesOf, getPartner, getPartners, isHeld, getGrappleGroup } from './partners'
import { getFightName } from './fighters'
import { getMoveCost } from './move'
import { canStandAt } from './ground'
import { getInterruptions } from './interruption'
import { dropHolders, getGrappleRows } from './grapple'

// ---------------------------------------------------------------------------
// Push and drag

// combat.tex "Grapple": several characters on one side of a test use "the
// highest skill value among them plus 3/2/1 for each additional character,
// up to a maximum of 5", a smaller one adding at most 2.
function sideTerms(values: { id: string; value: number; label: string }[], helpers: string[], state: CombatState): Term[] {
  if (values.length === 0) return []
  const lead = values.reduce((best, v) => (v.value > best.value ? v : best))
  const leader = state.characters[lead.id]
  const others = helpers.filter((id) => id !== lead.id)
  const bonus = Math.min(ASSIST.max, others.reduce((sum, id, i) => {
    const step = ASSIST.bonus[Math.min(i, ASSIST.bonus.length - 1)]
    const smaller = leader && state.characters[id] && getSize(state.characters[id]) < getSize(leader)
    return sum + (smaller ? Math.min(step, ASSIST.smallerMax) : step)
  }, 0))
  return [{ label: lead.label, value: lead.value }, ...(bonus > 0 ? [{ label: 'help', value: bonus }] : [])]
}

export type DragSides = {
  // everyone who moves, the actor included
  movers: string[]
  attackers: string[]
  resisters: string[]
  active: string[]
  carriers: string[]
  released: string[]
  attacker: Term[]
  // null: nobody resists at all
  defender: Term[] | null
}

// combat.tex "Push and drag": everyone locked in the grapple with the actor
// is dragged, each as they answered — resisting actively (their Force) or
// passively (at -5), helping actively (on the actor's side), going along,
// or, held by nobody, letting go and staying behind. Made as an opportunity
// attack, an active defense is at -2.
export function getDragSides(state: CombatState, root: DragAction): DragSides {
  const reactions = getReactionsTo(state, root.id)
  const chose = (kind: Action['kind']) => new Set(reactions.filter((r) => r.kind === kind).map((r) => r.actorId))
  const [assist, carry, letGo, resist] = [chose('assist'), chose('carry'), chose('letGo'), chose('resist')]
  const released = [...letGo].filter((id) => !isHeld(state.grapples, id))
  const grapples = dropHolders(state.grapples, (id) => released.includes(id))
  const movers = getGrappleGroup(grapples, root.actorId)
  const attackers = movers.filter((id) => id === root.actorId || assist.has(id))
  const carriers = movers.filter((id) => carry.has(id) && !attackers.includes(id))
  const resisters = movers.filter((id) => !attackers.includes(id) && !carriers.includes(id))
  const active = resisters.filter((id) => resist.has(id))
  const force = (id: string) => (state.characters[id] ? getForce(state.characters[id]) : 0)
  const name = (id: string) => getFightName(state, id)
  if (root.compared) return { movers, attackers, resisters, active, carriers, released, attacker: root.compared.attacker, defender: root.compared.defender }
  const attacker = sideTerms(attackers.map((id) => ({ id, value: force(id), label: `${name(id)} force` })), attackers, state)
  const defender = resisters.length === 0 ? null : [
    ...sideTerms(resisters.map((id) => ({ id, value: force(id) - (active.includes(id) ? 0 : 5), label: `${name(id)} force${active.includes(id) ? '' : ' (passive)'}` })), active, state),
    ...(root.opportunity && active.length > 0 ? [{ label: 'opportunity', value: -2 }] : []),
  ]
  return { movers, attackers, resisters, active, carriers, released, attacker, defender }
}

// "The strongest pushes the other by up to 1m and interrupts them. On a
// force difference equal or greater than 5, push them 2m. ... Nobody moves
// on a draw. The defender can only move the attacker if they spent the
// cost." There is no die: once the grapple has answered, the outcome is
// settled — who won, and how far they may push. "Moving within the grapple
// area, without displacing the opponent, is possible if Force is no lower
// than 5 points lower than the opponent": the actor may circle round
// instead, as far as a push would have gone, unless pushed back.
export type DragOutcome = {
  sides: DragSides
  diff: number
  // the side the push moves against, interrupted by it
  pushed: string[]
  // how far a push may go; 0 when nobody can be pushed
  push: number
  // how far the actor may circle; 0 when they may not
  circle: number
}

export function getDragOutcome(state: CombatState, root: DragAction): DragOutcome | null {
  const actor = state.characters[root.actorId]
  if (!state.board || !actor) return null
  const sides = getDragSides(state, root)
  const diff = sides.defender === null ? Infinity : sumTerms(sides.attacker) - sumTerms(sides.defender)
  const back = diff < 0 && sides.active.length > 0
  const pushed = diff > 0 ? sides.resisters : back ? sides.attackers : []
  // with everyone else going along, nobody is pushed but the group still moves
  const moves = pushed.length > 0 || (diff > 0 && sides.carriers.length > 0)
  const far = Math.abs(diff) >= 5 ? 2 : 1
  const circling = root.compared?.circling ?? canMoveInGrapple(state, actor)
  return { sides, diff, pushed, push: moves ? far : 0, circle: !back && circling ? (diff >= 5 ? 2 : 1) : 0 }
}

// The comparison as it stands now, to be written on the push when it is
// paid for: from then on its outcome is read off what was written.
export function getDragComparison(state: CombatState, root: DragAction): NonNullable<DragAction['compared']> {
  const actor = state.characters[root.actorId]
  const { attacker, defender } = getDragSides(state, { ...root, compared: null })
  return { attacker, defender, circling: !!actor && canMoveInGrapple(state, actor) }
}

// The choices the outcome leaves the winner, each open or not.
export function getDragChoices(state: CombatState, root: DragAction): { choice: 'push' | 'circle' | 'stay'; available: boolean }[] {
  const outcome = getDragOutcome(state, root)
  return [
    { choice: 'push', available: (outcome?.push ?? 0) > 0 },
    { choice: 'circle', available: (outcome?.circle ?? 0) > 0 && getCircleCells(state, root).length > 0 },
    { choice: 'stay', available: true },
  ]
}

// Whether the winner still has to say which way: a choice to make, or one
// made that still has to be pointed on the board.
export function needsDragAim(state: CombatState, root: DragAction): boolean {
  if (!getDragChoices(state, root).some((c) => c.choice !== 'stay' && c.available)) return false
  return root.choice === null || (root.choice === 'push' && root.direction === null) || (root.choice === 'circle' && root.to === null)
}

// Where the actor may circle to: every cell within the reach circling
// allows, got to one free step at a time, inside the grapple area.
export function getCircleCells(state: CombatState, root: DragAction): { cell: Coord; path: Coord[] }[] {
  const board = state.board
  const from = board?.placements[root.actorId]
  const actor = state.characters[root.actorId]
  const outcome = getDragOutcome(state, root)
  if (!board || !from || !actor || !outcome || outcome.circle === 0) return []
  return walkOut(from.cell, (steps) => steps <= outcome.circle, (cell) => {
    const placement = placeAt(board, from, cell)
    return canStandAt(state, root.actorId, placement) && isInGrappleArea(state, root.actorId, getFootprint(actor, placement))
  })
}

// Where everyone moved stands after each step of the way chosen, in order:
// the whole group along the push, only as far as all of them can stand; or
// the actor alone, circling.
export function getDragPath(state: CombatState, root: DragAction): { outcome: DragOutcome; steps: Record<string, Placement>[] } | null {
  const board = state.board
  const outcome = getDragOutcome(state, root)
  if (!board || !outcome) return null
  if (root.choice === 'circle' && root.to) {
    const from = board.placements[root.actorId]
    if (!from) return { outcome, steps: [] }
    const path = getCircleCells(state, root).find((c) => sameCell(c.cell, root.to!))?.path ?? []
    return { outcome, steps: path.map((cell) => ({ [root.actorId]: placeAt(board, from, cell) })) }
  }
  if (root.choice !== 'push' || root.direction === null || outcome.push === 0) return { outcome, steps: [] }
  const heading = DIRECTIONS[root.direction]
  let where: Record<string, Placement> = Object.fromEntries(outcome.sides.movers.flatMap((id) => {
    const origin = board.placements[id]
    return origin ? [[id, origin]] : []
  }))
  const steps: Record<string, Placement>[] = []
  for (let i = 0; i < Math.min(root.steps, outcome.push); i++) {
    const next: Record<string, Placement> = Object.fromEntries(Object.entries(where).map(([id, p]) => {
      const cell = add(p.cell, heading)
      return [id, placeAt(board, p, cell)]
    }))
    const moved = withPlacements(state, next)
    if (!Object.keys(next).every((id) => canStandAt(moved, id, next[id]))) break
    steps.push(next)
    where = next
  }
  return { outcome, steps }
}

// Whoever resisted actively "interrupt[ed] itself", and who let go instead
// of being dragged. Where the way goes is the displacement's to walk.
export function getDragFacts(state: CombatState, root: DragAction): DragFacts | null {
  const outcome = getDragOutcome(state, root)
  return outcome ? { interrupted: outcome.sides.active, released: outcome.sides.released } : null
}

// The displacement the push generates as it lands: the way pointed, step by
// step, from where everyone stands; the side pushed, and those who went
// along passively. Null when the way moves nobody — a stay, or a push that
// cannot take a step.
export function getDisplacement(state: CombatState, root: DragAction): Pick<DisplaceAction, 'path' | 'from' | 'pushed' | 'carriers' | 'opportunity'> | null {
  const path = getDragPath(state, root)
  if (!path || path.steps.length === 0) return null
  const pushing = root.choice === 'push'
  const from = Object.fromEntries(Object.keys(path.steps[0]).flatMap((id) => {
    const placement = state.board?.placements[id]
    return placement ? [[id, placement]] : []
  }))
  return { path: path.steps, from, pushed: pushing ? path.outcome.pushed : [], carriers: pushing ? path.outcome.sides.carriers : [], opportunity: root.opportunity }
}

// Where the displacement was brought to a stop: one step short of the
// stretch on which a third party's attack stunned the pusher, where everyone
// it moves stays, as an interrupted mover does. The table's ruling: the
// pusher goes along with the push, so like running and jumping it carries
// on through an interruption, and only a stun of the pusher stops it. Null
// while it goes on.
export function getPushStop(state: CombatState, root: DisplaceAction): number | null {
  const stunned = getInterruptions(state, root).find(({ level }) => level === 'stunned')
  const reaction = stunned ? getOpeningReaction(state, stunned.by) : null
  return reaction ? Math.max(0, (reaction.at ?? 1) - 1) : null
}

// The way walked as far as it got: where each ended, the side pushed
// interrupted by it if it moved at all, and what each who went along
// passively paid for the metres.
export function getDisplaceFacts(state: CombatState, root: DisplaceAction): DisplaceFacts {
  const stop = getPushStop(state, root)
  const steps = stop === null ? root.path : root.path.slice(0, stop)
  const taken = steps.length
  const carried = Object.fromEntries(root.carriers.flatMap((id) => (state.characters[id] && taken > 0 ? [[id, getMoveCost(state.characters[id], 'basic', taken).AP]] : [])))
  return { steps: taken, to: taken > 0 ? steps[taken - 1] : {}, interrupted: taken > 0 ? root.pushed : [], carried }
}

// ---------------------------------------------------------------------------
// Moving within the grapple

// combat.tex "Push and drag": "Moving within the grapple area, without
// displacing the opponent, is possible if Force is no lower than 5 points
// lower than the opponent" — than every partner's.
function canMoveInGrapple(state: CombatState, c: Character): boolean {
  return getPartners(state, c.id).every((id) => !state.characters[id] || getForce(c) >= getForce(state.characters[id]) - 5)
}

// The grapple area, as the table rules it: within reach of the grapple —
// the longest reach of any holder's grapple row, never under a cell.
function getGrappleReach(state: CombatState, g: Grapple): number {
  return Math.max(1, ...g.holders.flatMap((id) => {
    const holder = state.characters[id]
    return holder ? getGrappleRows(holder).flatMap((row) => (isMeleeRange(row.atk.range) ? [getReach(row.weapon, row.atk.range)] : [])) : []
  }))
}

// Whether a footprint of the character's keeps every partner on the board
// inside the grapple area.
function isInGrappleArea(state: CombatState, id: string, footprint: Coord[]): boolean {
  return getGrapplesOf(state, id).every((g) => {
    const partner = getPlacedFootprint(state, getPartner(g, id))
    return !partner || setDistance(footprint, partner) <= getGrappleReach(state, g)
  })
}
