import type { MovementKind } from '../../types'
import type { Action, CombatState, Coord, DisplaceAction, DisplaceFacts, DragAction, DragFacts, GrappleControl, Placement } from '../types'
import { ASSIST } from '../../tables'
import { getForce } from '../../character/rules/skills'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { Term, sumTerms } from '../../character/rules/terms'
import { add, subtract, walkOut } from '../geometry'
import { placeAt, withPlacements } from './board'
import { getOpeningReaction, getReactionsTo } from './log'
import { getGrapplesOf, isHeld, getGrappleGroup } from './partners'
import { getFightName } from './fighters'
import { getMoveCost } from './move'
import { canStandAt } from './ground'
import { getInterruptions } from './interruption'
import { dropHolders } from './grapple'

// ---------------------------------------------------------------------------
// Push and drag

// combat.tex "Push and drag": "Use the same rules for multiple characters as
// grapple" — combat.tex "Grapple": "the highest skill value among them plus
// 3/2/1 for each additional character, up to a maximum of 5 ... Characters
// with force 5 points lower than their opponent always add just +1". Each
// value is the Force left once its owner chose whether to pay, and the
// opponent is the strongest of the other side so reckoned (the table's
// ruling).
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

function force(state: CombatState, id: string): number {
  return state.characters[id] ? getForce(state.characters[id]) : 0
}

function strongest(values: SideValue[]): number {
  return Math.max(-Infinity, ...values.map((v) => v.value))
}

// combat.tex "Push and drag": "they can refuse to spend and take a -5
// penalty to the comparison" — anyone in the push may (the table's ruling).
const UNPAID = 5

export type DragSides = {
  // everyone in the group once whoever let go has, the actor included
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
// answers, each as they chose — resisting actively (their Force) or
// passively ("they can refuse to spend and take a -5 penalty"), helping on
// the actor's side, paying or not, going along on neither, or, held by
// nobody, letting go. An actor who does not pay takes the -5 too (the
// table's ruling). Made as an opportunity attack, an active defense is at
// -2.
export function getDragSides(state: CombatState, root: DragAction): DragSides {
  const reactions = getReactionsTo(state, root.id)
  const chose = (kind: Action['kind']) => new Set(reactions.filter((r) => r.kind === kind).map((r) => r.actorId))
  const [assist, carry, letGo, resist] = [chose('assist'), chose('carry'), chose('letGo'), chose('resist')]
  const unpaidHelpers = new Set(reactions.flatMap((r) => (r.kind === 'assist' && r.unpaid && !hasPaid(state, root, r.actorId) ? [r.actorId] : [])))
  const released = [...letGo].filter((id) => !isHeld(state.grapples, id))
  const grapples = dropHolders(state.grapples, (id) => released.includes(id))
  const movers = getGrappleGroup(grapples, root.actorId)
  const attackers = movers.filter((id) => id === root.actorId || assist.has(id))
  const carriers = movers.filter((id) => carry.has(id) && !attackers.includes(id))
  const resisters = movers.filter((id) => !attackers.includes(id) && !carriers.includes(id))
  const active = resisters.filter((id) => resist.has(id))
  const sides = { movers, attackers, resisters, active, carriers, released }
  if (root.compared) return { ...sides, attacker: root.compared.attacker, defender: root.compared.defender }
  const value = (id: string, paid: boolean): SideValue => ({
    id,
    value: force(state, id) - (paid ? 0 : UNPAID),
    label: `${getFightName(state, id)} force${paid ? '' : ' (not paid)'}`,
  })
  const pushing = attackers.map((id) => value(id, id === root.actorId ? !isUnpaid(state, root) : !unpaidHelpers.has(id)))
  const resisting = resisters.map((id) => value(id, active.includes(id)))
  const attacker = sideTerms(pushing, strongest(resisting))
  const defender = resisters.length === 0 ? null : [
    ...sideTerms(resisting, strongest(pushing)),
    ...(root.opportunity && active.length > 0 ? [{ label: 'opportunity', value: -2 }] : []),
  ]
  return { ...sides, attacker, defender }
}

// An actor who chose not to pay — but one who paid for the control being
// re-evaluated counts as having paid.
function isUnpaid(state: CombatState, root: DragAction): boolean {
  return root.unpaid && !hasPaid(state, root, root.actorId)
}

// combat.tex "Push and drag": "The stronger character gets control of
// movement for the group that round" — the actor, or the strongest of the
// other side, passive or not; an actor who did not pay only 10 over (the
// table's ruling). Only a resister who pays is interrupted: "If the defender
// spends the costs, they interrupt their action". "It is
// possible to move at basic movement speed when a group of characters have
// 10 force higher than the opponent group."
export type DragOutcome = {
  sides: DragSides
  diff: number
  // who controls the group; null on a draw or an unpaid push that fell short
  controller: string | null
  interrupted: string[]
  basic: boolean
}

const UNPAID_MARGIN = 10
const BASIC_MARGIN = 10

export function getDragOutcome(state: CombatState, root: DragAction): DragOutcome {
  const sides = getDragSides(state, root)
  const diff = sides.defender === null ? Infinity : sumTerms(sides.attacker) - sumTerms(sides.defender)
  const pushed = diff > 0 && (!isUnpaid(state, root) || diff >= UNPAID_MARGIN)
  const lead = sides.resisters.reduce<string | null>((best, id) => (best === null || force(state, id) > force(state, best) ? id : best), null)
  const controller = pushed ? root.actorId : diff < 0 ? lead : null
  return { sides, diff, controller, interrupted: sides.active, basic: controller !== null && Math.abs(diff) >= BASIC_MARGIN }
}

// The comparison as it stands now, to be written on the push when it is
// paid for: from then on its outcome is read off what was written.
export function getDragComparison(state: CombatState, root: DragAction): NonNullable<DragAction['compared']> {
  const { attacker, defender } = getDragSides(state, { ...root, compared: null })
  return { attacker, defender }
}

// Who paid for the push: the actor unless they chose not to, whoever helped,
// whoever resisted actively — and, made again for someone joining, whoever
// had paid for the control it re-evaluates.
function getPaid(state: CombatState, root: DragAction, sides: DragSides): string[] {
  const helpers = getReactionsTo(state, root.id).flatMap((r) => (r.kind === 'assist' && !r.unpaid && sides.attackers.includes(r.actorId) ? [r.actorId] : []))
  const now = [...(isUnpaid(state, root) ? [] : [root.actorId]), ...helpers, ...sides.active]
  return [...new Set([...(root.recheck ? getLiveControl(state, root.actorId)?.paid ?? [] : []), ...now])]
}

function hasPaid(state: CombatState, root: DragAction, id: string): boolean {
  return root.recheck && (getLiveControl(state, root.actorId)?.paid ?? []).includes(id)
}

// combat.tex "Push and drag": "This costs 3AP +2STA for both attacker and
// defender", and whoever helps; nothing for one who chose not to pay, nor,
// made again for someone joining, for whoever already paid this round
// (the table's ruling). `action` is the push itself or an answer to it.
export function getPushPrice(state: CombatState, root: DragAction, action: Pick<Action, 'kind' | 'actorId'> & { unpaid?: boolean }): ActionCost {
  const c = state.characters[action.actorId]
  if (!c || action.unpaid || hasPaid(state, root, action.actorId)) return { AP: 0, STA: 0 }
  return getActionCost(c, 'pushDrag')
}

// What the push came to, written at the resolve.
export function getDragFacts(state: CombatState, root: DragAction): DragFacts {
  const outcome = getDragOutcome(state, root)
  const control = outcome.controller === null ? null : { controller: outcome.controller, round: state.round, basic: outcome.basic, paid: getPaid(state, root, outcome.sides), carriers: outcome.sides.carriers }
  return { interrupted: outcome.interrupted, released: outcome.sides.released, control }
}

// ---------------------------------------------------------------------------
// Control

// The control over the character's group won this round, if any.
export function getLiveControl(state: CombatState, id: string): GrappleControl | null {
  return getGrapplesOf(state, id).find((g) => g.control && g.control.round === state.round)?.control ?? null
}

export function isInControl(state: CombatState, id: string): boolean {
  return getLiveControl(state, id)?.controller === id
}

// combat.tex "Push and drag": "at careful movement speed", basic with 10
// Force over the other side.
export function getGroupMovement(state: CombatState, id: string): MovementKind {
  return getLiveControl(state, id)?.basic ? 'basic' : 'careful'
}

// combat.tex "Push and drag": someone who has just joined a group under
// control — a pair of the group with no control on it — "reevaluates the
// comparison" (the table's ruling): the controller's, made again.
export function getControlRecheck(state: CombatState, pair: readonly [string, string]): string | null {
  const joined = state.grapples.find((g) => g.members.includes(pair[0]) && g.members.includes(pair[1]))
  if (!joined || joined.control?.round === state.round) return null
  const group = getGrappleGroup(state.grapples, pair[0])
  const control = group.flatMap((id) => getGrapplesOf(state, id)).find((g) => g.control?.round === state.round)?.control
  return control && group.includes(control.controller) ? control.controller : null
}

// ---------------------------------------------------------------------------
// Moving the group

// Where everyone in the group stands with the controller's anchor at `cell`,
// each keeping where they stood to them.
function groupAt(state: CombatState, controllerId: string, cell: Coord): Record<string, Placement> | null {
  const board = state.board
  const from = board?.placements[controllerId]
  if (!board || !from) return null
  const offset = subtract(cell, from.cell)
  return Object.fromEntries(getGrappleGroup(state.grapples, controllerId).flatMap((id) => {
    const p = board.placements[id]
    return p ? [[id, placeAt(board, p, add(p.cell, offset))]] : []
  }))
}

function canGroupStand(state: CombatState, placements: Record<string, Placement>): boolean {
  const moved = withPlacements(state, placements)
  return Object.entries(placements).every(([id, p]) => canStandAt(moved, id, p))
}

// What moving the group the given cells costs the controller.
export function getDisplaceCost(state: CombatState, root: DisplaceAction, cells: number): ActionCost | null {
  const c = state.characters[root.actorId]
  return c ? getMoveCost(c, getGroupMovement(state, root.actorId), cells) : null
}

// Where everyone stands after each step of the controller's way; null when
// some step leaves someone where they cannot stand, or is not a step.
export function getGroupSteps(state: CombatState, root: DisplaceAction): Record<string, Placement>[] | null {
  const steps: Record<string, Placement>[] = []
  for (const cell of root.path) {
    const at = groupAt(state, root.actorId, cell)
    if (!at || !canGroupStand(state, at)) return null
    steps.push(at)
  }
  return steps
}

// Where the group set out from.
export function getGroupOrigin(state: CombatState, root: DisplaceAction): Record<string, Placement> {
  const board = state.board
  return Object.fromEntries(getGrappleGroup(state.grapples, root.actorId).flatMap((id) => (board?.placements[id] ? [[id, board.placements[id]]] : [])))
}

// Every cell the controller can take the group to, as they can pay for it,
// with the shortest way there.
export function getGroupReach(state: CombatState, root: DisplaceAction): { cell: Coord; steps: number; path: Coord[] }[] {
  const c = state.characters[root.actorId]
  const from = state.board?.placements[root.actorId]
  if (!c || !from) return []
  const affordable = (steps: number) => canAfford(c, getDisplaceCost(state, root, steps) ?? { AP: Infinity, STA: 0 })
  return walkOut(from.cell, affordable, (cell) => {
    const at = groupAt(state, root.actorId, cell)
    return !!at && canGroupStand(state, at)
  })
}

// Where the group was brought to a stop: one step short of the stretch on
// which a third party's attack stunned the controller, where everyone stays,
// as an interrupted mover does. The table's ruling: like running and
// jumping it carries on through an interruption, and only a stun of the
// controller stops it. Null while it goes on.
export function getPushStop(state: CombatState, root: DisplaceAction): number | null {
  const stunned = getInterruptions(state, root).find(({ level }) => level === 'stunned')
  const reaction = stunned ? getOpeningReaction(state, stunned.by) : null
  return reaction ? Math.max(0, (reaction.at ?? 1) - 1) : null
}

// The way walked as far as it got, where each ended, and what each who
// chose to go along paid for the metres, at the group's speed.
export function getDisplaceFacts(state: CombatState, root: DisplaceAction): DisplaceFacts {
  const stop = getPushStop(state, root)
  const steps = getGroupSteps(state, root) ?? []
  const walked = stop === null ? steps : steps.slice(0, stop)
  const movement = getGroupMovement(state, root.actorId)
  const carriers = walked.length > 0 ? getLiveControl(state, root.actorId)?.carriers ?? [] : []
  const carried = Object.fromEntries(carriers.flatMap((id) => (state.characters[id] && walked[0][id] ? [[id, getMoveCost(state.characters[id], movement, walked.length)]] : [])))
  return { steps: walked.length, to: walked.at(-1) ?? {}, carried }
}
