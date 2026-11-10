import type { Action, ActionOf, SceneState, Placement, ShootAction, StrikeAction } from '../types'
import { getReactionsTo } from './log'
import type { CampaignCharacter } from '../../types'
import { line, setDistance } from './board/geometry'
import { getFootprint, getPlacedFootprint, getReach, isGuardingShot, withPlacements } from './board/board'
import { findWeaponRow, type WeaponRow } from './weaponRow'
import { makeAction } from '../factories'
import { canCarryStep, getCombinedMoves } from './combinedMove'

// The block or intercept someone meets a strike with, their own or made for
// someone else (combat.tex "Protect"), or the guard they meet a shot with
// (combat.tex "Guard").
export type GuardingReaction = ActionOf<'block'> | ActionOf<'intercept'> | ActionOf<'guard'>

// combat.tex "Protect": "It is possible to defend an ally by staying within
// one space distance of the line between attacker and target. The defender
// can block or intercept an attack directed at an ally." Anyone may (the
// table's ruling: the fight has no sides). The line runs between where the
// two stand, and the protector stands nearer the attacker than the target
// does (the table's ruling): beside or behind the target is no protection.
export function isOnProtectLine(state: SceneState, root: StrikeAction, id: string, placement: Placement): boolean {
  const c = state.characters[id]
  const from = state.board?.placements[root.actorId]
  const to = root.targetId ? state.board?.placements[root.targetId] : undefined
  if (!c || !from || !to) return false
  const attacker = getPlacedFootprint(state, root.actorId) ?? [from.cell]
  const target = getPlacedFootprint(state, root.targetId!) ?? [to.cell]
  const here = getFootprint(c, placement)
  return setDistance(here, line(from.cell, to.cell)) <= 1 && setDistance(here, attacker) < setDistance(target, attacker)
}

// Who may block for the strike's target: anyone else placed on the line, or
// able to get onto it with a move a block carries (rules/combinedMove.ts).
export function getProtectors(state: SceneState, root: StrikeAction): string[] {
  return Object.keys(state.characters).filter((id) => {
    const at = state.board?.placements[id]
    if (id === root.actorId || id === root.targetId || !at) return false
    return isOnProtectLine(state, root, id, at) || canStepToGuard(state, root, makeAction('block', { id: '', actorId: id, reactionTo: root.id }))
  })
}

// combat.tex "Protect", "Intercept": whoever else could intercept for the
// strike's target, which asks only for the weapon's short range of the
// attacker, from where they stand or after a move an intercept carries.
export function getInterceptors(state: SceneState, root: StrikeAction, rowsOf: (c: CampaignCharacter) => WeaponRow[]): string[] {
  return Object.keys(state.characters).filter((id) => {
    const c = state.characters[id]
    const at = state.board?.placements[id]
    if (id === root.actorId || id === root.targetId || !at) return false
    return rowsOf(c).some((row) => {
      const intercept = makeAction('intercept', { id: '', actorId: id, reactionTo: root.id, weaponKey: row.wielded.key, attack: row.atk.name })
      return isGuardPlacedAt(state, root, intercept, at) || canStepToGuard(state, root, intercept)
    })
  })
}

// combat.tex "Guard": whoever else could get next to the shot's target, nearer
// its source, with a move a guard carries (rules/combinedMove.ts); those who
// stand there already are found by the board (`isGuardingShot`).
export function getStepGuards(state: SceneState, root: ShootAction): string[] {
  return Object.keys(state.characters).filter((id) => {
    if (id === root.actorId || id === root.targetId || !state.board?.placements[id]) return false
    return canStepToGuard(state, root, makeAction('guard', { id: '', actorId: id, reactionTo: root.id }))
  })
}

// Whether the character stands where a guard against the shot can be made
// from: in front of the lead shot or of a shot joined to it. A shot aimed at
// the ground is guarded only by those standing by it (rules/reactions.ts).
export function isStandingGuard(state: SceneState, root: Action, id: string): boolean {
  if (root.kind !== 'shoot' || !root.targetId) return true
  const shooters = [root.actorId, ...getReactionsTo(state, root.id).flatMap((r) => (r.kind === 'joinShot' ? [r.actorId] : []))]
  return shooters.some((shooter) => isGuardingShot(state, shooter, root.targetId!, id))
}

function canStepToGuard(state: SceneState, root: StrikeAction | ShootAction, guard: GuardingReaction): boolean {
  const c = state.characters[guard.actorId]
  return !!c && getCombinedMoves(c, guard.kind).some((entry) => entry.recipe.order === 'before' && canCarryStep(state, root, { ...guard, recipe: entry.id }, entry))
}

// combat.tex "Intercept": "It requires the defender to be in short range" —
// of the attacker, at the intercepting weapon's short reach.
export function isInInterceptRange(state: SceneState, root: StrikeAction, id: string, placement: Placement, weaponKey: string, attack: string): boolean {
  const c = state.characters[id]
  const attacker = getPlacedFootprint(state, root.actorId)
  const row = c ? findWeaponRow(c, weaponKey, attack) : null
  if (!c || !row) return false
  return !attacker || setDistance(getFootprint(c, placement), attacker) <= getReach(row.weapon, 'short')
}

// Whether the block, intercept or guard can be made from the placement: an
// intercept within short range of the attacker, wherever it stands, a block
// made for someone else from the line, a guard made for someone else next to
// them and nearer the shot's source.
export function isGuardPlacedAt(state: SceneState, root: StrikeAction | ShootAction, reaction: GuardingReaction, at: Placement): boolean {
  if (reaction.kind === 'guard') {
    return root.kind === 'shoot' && root.targetId !== null && isGuardingShot(withPlacements(state, { [reaction.actorId]: at }), root.actorId, root.targetId, reaction.actorId)
  }
  if (root.kind !== 'strike') return false
  if (reaction.kind === 'block' && reaction.actorId !== root.targetId && !isOnProtectLine(state, root, reaction.actorId, at)) return false
  return reaction.kind !== 'intercept' || isInInterceptRange(state, root, reaction.actorId, at, reaction.weaponKey, reaction.attack)
}

// Whether the block or intercept stands where it may be made from. Anywhere,
// on a fight without a board.
export function isGuardPlaced(state: SceneState, root: StrikeAction, reaction: ActionOf<'block'> | ActionOf<'intercept'>): boolean {
  const here = state.board?.placements[reaction.actorId]
  return !here || isGuardPlacedAt(state, root, reaction, here)
}
