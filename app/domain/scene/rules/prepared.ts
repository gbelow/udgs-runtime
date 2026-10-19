import { isCombatStarted } from './started'
import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionOf, SceneState, Coord, Placement, PreparableKind, PrepareAction, PreparedTrigger, RootAction, ShootAction, StrikeAction } from '../types'
import { SPELLS, isSpellKey } from '../../spells'
import { getCastRange, getTargetEffects } from '../../character/rules/production'
import { canCastSpell, getCastSize } from '../../character/rules/spells'
import { canAfford } from '../../character/rules/cost'
import type { ActionCost } from '../../character/rules/actionCosts'
import { isCampaignCharacter } from '../../utils'
import { makeAction } from '../factories'
import { firstStep, getPathDistances } from './approach'
import { getActionCost } from '../../character/rules/actionCosts'
import { line, setDistance } from './board/geometry'
import { getFootprint, getPlacedFootprint, getShotReachOf, getStrikeReach, seesAcross, withPlacements } from './board/board'
import { defRows, getAttackVariant, guardRows, isShotLoaded } from './attack'
import { isImmobile } from './situational'
import { getMoveBlockCells, getMovementOptions, getWalkableCells } from './move'
import { getMoveWaypoint } from './board/waypoint'
import { getAction, getAncestry, getLiveReactionsTo, getPassedUp, getRootOf, getSpawned } from './log'
import { getHeldOf } from './hold'
import { ACTIONS, isReaction } from './actionCatalog'
import { getJoinReaction } from './coordinated'
import { isInInterceptRange, isOnProtectLine } from './protect'
import type { Trigger } from './reactions'
import { pickShotDeclaration, pickStrikeDeclaration } from './declaration'
import { getStrikeContext, getStrikePrice, isStrikeDeclarationOpen } from './strikeDeclaration'

// combat.tex "Preparing a reaction": "Any action can be prepared on a player's
// turn, but doing so costs 1 AP. This allows the player to create any trigger
// they can imagine for a reaction. They must have enough AP to perform the
// reaction when the trigger occurs. A prepared action can consist of 2 AP of
// movement and one other action, which can also be movement, and can be
// repeated multiple times as long as the trigger happens again. The movement
// part of the action can be skipped when performing the reaction, but the
// other action must be performed. Reacting to anything else while performing
// the prepared action will cancel it. An action stays prepared until the end
// of the round."

export const PREPARED_MOVE_AP = 2

// combat.tex "Protect", "Guard": a defense is made for someone else — the
// target is attacked and the preparer is not — so it is the one kind of
// preparation that answers an attack, and the movement it carries is the
// reposition that gets its preparer onto the line before the die is thrown.
export const PREPARED_DEFENSES = ['block', 'intercept', 'guard'] as const
export type PreparedDefenseKind = (typeof PREPARED_DEFENSES)[number]
export type PreparedDefense = ActionOf<PreparedDefenseKind>

export function isDefenseMain(main: PreparableKind | null): main is PreparedDefenseKind {
  return main === 'block' || main === 'intercept' || main === 'guard'
}

// What a preparation of that action can wait for: a defense, its protected one
// being attacked; anything else, someone coming into its reach or sight.
export function getPreparedEvents(main: PreparableKind | null): PreparedTrigger['event'][] {
  return isDefenseMain(main) ? ['attacked'] : ['enters', 'sighted']
}

// What is prepared in the round: the preparations that have landed since it
// began, of characters still in the fight.
export function getPrepared(state: SceneState): PrepareAction[] {
  return state.prepared.flatMap((id) => {
    const a = getAction(state, id)
    return a?.kind === 'prepare' && state.characters[a.actorId] ? [a] : []
  })
}

export function findPrepared(state: SceneState, id: string): PrepareAction | null {
  return getPrepared(state).find((p) => p.id === id) ?? null
}

// The action the preparation is for, as it is made once its trigger has come:
// what it is made with is the preparation's, what it is aimed at is still to be
// declared.
export function getPreparedMain(p: PrepareAction, id: string, spawnedBy: string | null = null): RootAction | null {
  const base = { id, actorId: p.actorId, spawnedBy, preparedPart: 'main' as const }
  switch (p.main) {
    case 'strike': return makeAction('strike', { ...base, ...pickStrikeDeclaration(p) })
    case 'shoot': return makeAction('shoot', { ...base, ...pickShotDeclaration(p) })
    case 'cast': return makeAction('cast', { ...base, key: p.key, quicken: p.quicken, extend: p.extend })
    case 'move': return makeAction('move', { ...base, movement: p.movement })
    // a defense is answered to an attack, not made as an action of its own
    case 'block':
    case 'intercept':
    case 'guard':
    case null: return null
  }
}

// What the main action costs at the least, as the preparation made it; null
// while the character cannot make it at all.
export function getMainCost(state: SceneState, c: CampaignCharacter, p: PrepareAction): ActionCost | null {
  if (isDefenseMain(p.main)) {
    const price = ACTIONS[p.main].price
    return price && defRows(c).some((row) => row.wielded.key === p.weaponKey && row.atk.name === p.attack) ? getActionCost(c, price) : null
  }
  const main = getPreparedMain(p, '')
  switch (main?.kind) {
    case 'strike': {
      const ctx = getStrikeContext(state, p)
      const price = ctx && isStrikeDeclarationOpen(ctx) ? getStrikePrice(ctx) : null
      return price && [price.declared, ...price.added].reduce((sum, t) => ({ AP: sum.AP + t.AP, STA: sum.STA + t.STA }), { AP: 0, STA: 0 })
    }
    case 'shoot': {
      const variant = getAttackVariant(c, main, isCombatStarted(state))
      return variant && isShotLoaded(c, main) ? { AP: variant.AP, STA: variant.STA } : null
    }
    case 'cast':
      return isSpellKey(main.key) && canCastSpell(c, main.key, main.quicken, isCombatStarted(state)) ? { AP: SPELLS[main.key].cost.AP, STA: SPELLS[main.key].cost.STA } : null
    case 'move': {
      const blocks = getMovementOptions(state, c).filter((o) => o.available && o.speed > 0).map((o) => o.block)
      return blocks.length === 0 ? null : blocks.reduce((least, b) => (b.AP < least.AP ? b : least))
    }
    default:
      return null
  }
}

// Why the preparation cannot be carried out by the character now, or null.
// "They must have enough AP to perform the reaction when the trigger occurs."
export function getPreparedBar(state: SceneState, c: CampaignCharacter, p: PrepareAction): string | null {
  if (isImmobile(state, c)) return 'immobile'
  const cost = getMainCost(state, c, p)
  if (!cost) return 'cannot be made now'
  return canAfford(c, cost, isCombatStarted(state)) ? null : 'cannot afford'
}

// How much of the preparation's 2 AP of movement may be spent: what is left
// once the action that must be performed is paid for.
export function getPreparedMoveBudget(state: SceneState, c: CampaignCharacter, p: PrepareAction): number {
  const cost = getMainCost(state, c, p)
  if (!cost) return 0
  const spare = c.resources.AP - cost.AP
  return Math.max(0, Math.min(PREPARED_MOVE_AP, spare))
}

// Whether the declaration is one that can be committed: an action the character
// can make, and a trigger that is about someone else.
export function isPrepareComplete(state: SceneState, c: Character, p: PrepareAction): boolean {
  if (!isCampaignCharacter(c) || p.main === null || p.trigger === null) return false
  if (!state.board?.placements[c.id]) return false
  if (p.trigger.who !== null && (p.trigger.who === c.id || !state.characters[p.trigger.who])) return false
  if (!getPreparedEvents(p.main).includes(p.trigger.event)) return false
  return getMainCost(state, c, p) !== null
}

// ---------------------------------------------------------------------------
// Triggers

// How far the preparation reaches from where its preparer stands: the main
// action's own reach and the movement it may carry — "the area trigger should
// include the movement range" (the table's ruling).
export function getPreparedZone(state: SceneState, c: CampaignCharacter, p: PrepareAction): number {
  const movement = Math.max(getMoveBlockCells(c, 'basic', PREPARED_MOVE_AP), getMoveBlockCells(c, 'careful', PREPARED_MOVE_AP))
  return getMainReach(state, c, p) + movement
}

function getMainReach(state: SceneState, c: CampaignCharacter, p: PrepareAction): number {
  const main = getPreparedMain(p, '')
  switch (main?.kind) {
    case 'strike': return getStrikeReach(state, main) ?? 0
    case 'shoot': return getShotReachOf(state, main) ?? 0
    case 'cast': {
      if (!isSpellKey(main.key)) return 0
      const size = getCastSize(c, main.key, 0, main.itemId)
      return Math.max(0, ...getTargetEffects(SPELLS[main.key].effects).map((e) => getCastRange(e, main.extend, size) ?? 1))
    }
    default: return 0
  }
}

// Who a prepared action answers: a move by anyone it waits for, at the step
// that brings them into the trigger (counted as an opportunity attack's is,
// which stands the mover on the cell that did). Nothing a prepared action
// itself opens answers one (the table's ruling: no chaining).
export function getPreparedTriggers(state: SceneState, root: RootAction): Trigger[] {
  if (root.kind === 'strike' || root.kind === 'shoot') return getDefenseTriggers(state, root)
  return getMoveTriggers(state, root)
}

function getMoveTriggers(state: SceneState, root: RootAction): Trigger[] {
  if (root.kind !== 'move' || !state.board || root.path.length === 0) return []
  if (root.movement === 'prone' || root.movement === 'stand' || isFromPrepared(state, root)) return []
  const mover = state.characters[root.actorId]
  const from = state.board.placements[root.actorId]
  if (!mover || !from) return []
  const placements = [from, ...root.path.map((cell) => ({ ...from, cell }))]
  return getPrepared(state).flatMap((p): Trigger[] => {
    const owner = state.characters[p.actorId]
    const other = getPlacedFootprint(state, p.actorId)
    if (!owner || !other || p.actorId === root.actorId || p.trigger === null) return []
    if (p.trigger.who !== null && p.trigger.who !== root.actorId) return []
    const step = getTriggerStep(state, mover, placements, other, owner, p)
    return step === null ? [] : [{ characterId: owner.id, kind: 'prepared', at: step + 1, against: root.actorId, preparedId: p.id }]
  })
}

// combat.tex "Protect", "Guard": who has prepared a defense of the one the
// attack is aimed at, and can be on the line to make it — from where they
// stand or from any space the movement they carry reaches. Nothing comes of
// what a prepared action opened (the table's ruling: no chaining), nor of a
// shot joined to another, which is defended against the lead.
function getDefenseTriggers(state: SceneState, root: StrikeAction | ShootAction): Trigger[] {
  const target = root.targetId
  if (!state.board || !target || isFromPrepared(state, root) || (root.kind === 'shoot' && getJoinReaction(state, root))) return []
  return getPrepared(state).flatMap((p): Trigger[] => {
    const kind = p.main
    const owner = state.characters[p.actorId]
    if (!isDefenseMain(kind) || !isCampaignCharacter(owner) || p.trigger?.event !== 'attacked') return []
    if ((root.kind === 'shoot') !== (kind === 'guard') || owner.id === root.actorId || owner.id === target) return []
    if (p.trigger.who !== null && p.trigger.who !== target) return []
    return getDefensePlacements(state, root, owner, p).length === 0 ? [] : [{ characterId: owner.id, kind, at: null, against: target, preparedId: p.id }]
  })
}

// Where the preparer may make the defense from: where they stand, and where
// the movement they carry takes them, on the line — "within one space distance
// of the line between attacker and target" (a block), within short range of
// the attacker too (an intercept), next to the target and nearer the shooter
// (a guard).
function getDefensePlacements(state: SceneState, root: StrikeAction | ShootAction, owner: CampaignCharacter, p: PrepareAction): Placement[] {
  const from = state.board?.placements[owner.id]
  if (!from) return []
  const budget = getPreparedMoveBudget(state, owner, p)
  const probe = makeAction('move', { id: '', actorId: owner.id, budget })
  const reached = budget <= 0 ? [] : getMovementOptions(state, owner, probe)
    .filter((o) => o.available && o.speed > 0)
    .flatMap((o) => getWalkableCells(state, { ...probe, movement: o.kind }).map(({ cell }): Placement => ({ ...from, cell })))
  return [from, ...reached].filter((placement) => isPlacedToDefend(state, root, owner, p, placement))
}

// A guard prepared for an ally stands anywhere along the arrow's way (the
// table's ruling): within one space of the line between shooter and target, and
// nearer the shooter than the target is.
function isOnShotLine(state: SceneState, shot: ShootAction, guard: CampaignCharacter, placement: Placement): boolean {
  const from = state.board?.placements[shot.actorId]
  const to = shot.targetId ? state.board?.placements[shot.targetId] : undefined
  const shooter = getPlacedFootprint(state, shot.actorId)
  const target = shot.targetId ? getPlacedFootprint(state, shot.targetId) : null
  if (!from || !to || !shooter || !target || guard.id === shot.actorId) return false
  const mine = getFootprint(guard, placement)
  return setDistance(mine, line(from.cell, to.cell)) <= 1 && setDistance(shooter, mine) < setDistance(shooter, target)
}

function isPlacedToDefend(state: SceneState, root: StrikeAction | ShootAction, owner: CampaignCharacter, p: PrepareAction, placement: Placement): boolean {
  if (root.kind === 'shoot') return isOnShotLine(state, root, owner, placement) && guardRows(state, owner, root).some((row) => row.wielded.key === p.weaponKey && row.atk.name === p.attack)
  return p.main === 'intercept' ? isInInterceptRange(state, root, owner.id, placement, p.weaponKey, p.attack) : isOnProtectLine(state, root, owner.id, placement)
}

// The step of the way, counted from 1, at which the mover comes into the
// preparation's trigger from outside it.
function getTriggerStep(state: SceneState, mover: Character, placements: Placement[], other: Coord[], owner: CampaignCharacter, p: PrepareAction): number | null {
  switch (p.trigger?.event) {
    case 'enters': {
      const zone = getPreparedZone(state, owner, p)
      return firstStep(getPathDistances(mover, placements, other), (previous, now) => previous > zone && now <= zone)
    }
    case 'sighted': {
      const board = state.board
      if (!board) return null
      const seen = placements.map((placement) => (seesAcross(board, getFootprint(mover, placement), other) ? 1 : 0))
      return firstStep(seen, (previous, now) => previous === 0 && now === 1)
    }
    case 'attacked':
    case undefined: return null
  }
}

// ---------------------------------------------------------------------------
// What a fired preparation opened

// The movement a prepared reaction opened, once it has, and which of its parts
// were passed up instead.
export function getPreparedParts(state: SceneState, reaction: Action): { move: Action | null; passedMove: boolean; passedMain: boolean } {
  const passed = getPassedUp(state, reaction.id)
  return {
    move: getSpawned(state, reaction.id).find((a) => a.preparedPart === 'move') ?? null,
    passedMove: passed.some((a) => a.preparedPart === 'move'),
    passedMain: passed.some((a) => a.preparedPart === 'main'),
  }
}

// Whether the move reaches the cell the prepared action fired on: a move cut
// short before it never gets there.
export function isPreparedReached(reaction: ActionOf<'prepared'>, walked: number): boolean {
  return reaction.at === null || reaction.at - 1 <= walked
}

// combat.tex "Preparing a reaction": "Reacting to anything else while
// performing the prepared action will cancel it." Whether its preparer has
// made a reaction of their own to anything the prepared action opened, or to
// what that opened in turn, and still has it in play or landed: one taken
// back cancels nothing.
export function isPreparedCancelled(state: SceneState, reaction: Action): boolean {
  return reaction.reactedWithin.some((id) => getAction(state, id) !== null)
}

// The actions a reaction, as it is declared, is made within: what it comes of
// that its own actor took (`reactedWithin`).
export function getReactedWithin(state: SceneState, declared: Action): Action[] {
  if (!isReaction(declared.kind) || declared.kind === 'prepared') return []
  const held = getHeldOf(state, declared.actorId)
  return [...getAncestry(state, declared).filter((a) => a.actorId === declared.actorId), ...(held ? [held] : [])]
}

// "No chaining": whether the action is, or comes of, a prepared reaction — a
// prepared action's, or a defense prepared as one.
export function isFromPrepared(state: SceneState, action: Action): boolean {
  return [action, ...getAncestry(state, action)].some((a) => a.kind === 'prepared' || (isPreparedDefense(a) && a.preparedId !== ''))
}

export function isPreparedDefense(action: Action): action is PreparedDefense {
  return action.kind === 'block' || action.kind === 'intercept' || action.kind === 'guard'
}

// Where the mover stands while the prepared action is fought: on the cell that
// brought them into its trigger.
export function getPreparedState(state: SceneState, reaction: ActionOf<'prepared'>): SceneState {
  const root = getRootOf(state, reaction)
  if (root?.kind !== 'move' || reaction.at === null) return state
  const waypoint = getMoveWaypoint(state, root, reaction.at - 1)
  return waypoint ? withPlacements(state, { [root.actorId]: waypoint }) : state
}

// ---------------------------------------------------------------------------
// A defense's reposition

// The defenses declared against the root that were prepared, not yet paid.
export function getPreparedDefenses(state: SceneState, root: Action): PreparedDefense[] {
  return getLiveReactionsTo(state, root.id).filter((r): r is PreparedDefense => isPreparedDefense(r) && r.preparedId !== '')
}

// What a prepared defense is made against, by whom, as what: null once any of
// them is gone.
function getDefenseSetting(state: SceneState, reaction: PreparedDefense): { root: StrikeAction | ShootAction; owner: CampaignCharacter; prepared: PrepareAction } | null {
  const root = getRootOf(state, reaction)
  const prepared = findPrepared(state, reaction.preparedId)
  const owner = state.characters[reaction.actorId]
  return (root?.kind === 'strike' || root?.kind === 'shoot') && prepared && isCampaignCharacter(owner) ? { root, owner, prepared } : null
}

// Whether the preparer stands where the defense can be made from, as they
// stand now.
export function isDefensePlaced(state: SceneState, reaction: PreparedDefense): boolean {
  const setting = getDefenseSetting(state, reaction)
  const here = state.board?.placements[reaction.actorId]
  return !!setting && !!here && isPlacedToDefend(state, setting.root, setting.owner, setting.prepared, here)
}

// Whether the movement a defense carries can still get its preparer where it
// can be made from.
export function canReposition(state: SceneState, reaction: PreparedDefense): boolean {
  const setting = getDefenseSetting(state, reaction)
  return !!setting && getDefensePlacements(state, setting.root, setting.owner, setting.prepared).length > 0
}

// The prepared defense whose movement has still to be offered: the movement
// comes before the die, so the defense is rolled with its preparer where they
// ended. Offered while there is AP to carry it, and to one already on the line
// too, who may use it or pass it up.
export function getPendingReposition(state: SceneState, root: Action): { reaction: PreparedDefense; budget: number } | null {
  for (const reaction of getPreparedDefenses(state, root)) {
    const prepared = findPrepared(state, reaction.preparedId)
    const owner = state.characters[reaction.actorId]
    const { move, passedMove } = getPreparedParts(state, reaction)
    if (!prepared || !owner || move || passedMove || isPreparedCancelled(state, reaction)) continue
    const budget = getPreparedMoveBudget(state, owner, prepared)
    if (budget > 0) return { reaction, budget }
  }
  return null
}

// The prepared defenses that come to nothing: cancelled by a reaction their
// preparer made to what the movement drew, or not on the line once it has been
// walked.
export function getLapsedDefenses(state: SceneState, root: Action): PreparedDefense[] {
  return getPreparedDefenses(state, root).filter((r) => isPreparedCancelled(state, r) || !isDefensePlaced(state, r))
}

// Whether a reposition ends where the defense it was opened for can be made
// from; any other move is not one.
export function isRepositionPlaced(state: SceneState, move: ActionOf<'move'>): boolean {
  const reaction = move.preparedPart === 'move' && move.spawnedBy ? getAction(state, move.spawnedBy) : null
  if (!reaction || !isPreparedDefense(reaction) || reaction.preparedId === '') return true
  const setting = getDefenseSetting(state, reaction)
  const from = state.board?.placements[reaction.actorId]
  const end = move.path.at(-1)
  if (!setting || !from || !end) return false
  return canRepositionTo(state, setting, { ...from, cell: end })
}

// Whether the preparer may walk to the placement to make the defense: it can
// be made from there, and no evasive jump answering the same attack is landing
// on it — the jump was declared first and has the space (the table's ruling).
function canRepositionTo(state: SceneState, setting: NonNullable<ReturnType<typeof getDefenseSetting>>, placement: Placement): boolean {
  if (!isPlacedToDefend(state, setting.root, setting.owner, setting.prepared, placement)) return false
  const landings = getLiveReactionsTo(state, setting.root.id).flatMap((r) => {
    const jumper = state.characters[r.actorId]
    return r.kind === 'evasiveJump' && r.to && jumper && r.actorId !== setting.owner.id ? getFootprint(jumper, r.to) : []
  })
  return !getFootprint(setting.owner, placement).some((c) => landings.some((l) => l.q === c.q && l.r === c.r))
}

// Of the spaces a move can reach, the ones it is worth walking to: for the
// reposition of a prepared defense, only those it can be made from; every other
// move may go anywhere it reaches.
export function getUsableCells<C extends { cell: Coord }>(state: SceneState, move: ActionOf<'move'>, cells: C[]): C[] {
  const reaction = move.preparedPart === 'move' && move.spawnedBy ? getAction(state, move.spawnedBy) : null
  const setting = reaction && isPreparedDefense(reaction) && reaction.preparedId !== '' ? getDefenseSetting(state, reaction) : null
  const from = state.board?.placements[move.actorId]
  if (!setting || !from) return cells
  return cells.filter(({ cell }) => canRepositionTo(state, setting, { ...from, cell }))
}
