import type { ActionOf, SceneState, Placement, StrikeAction } from '../types'
import type { CampaignCharacter } from '../../types'
import { line, setDistance } from './board/geometry'
import { getFootprint, getPlacedFootprint, getReach } from './board/board'
import { findWeaponRow, type WeaponRow } from './weaponRow'
import { makeAction } from '../factories'
import { canCarryStep, getCombinedMoves } from './combinedMove'

// The block or intercept someone meets a strike with, their own or made for
// someone else (combat.tex "Protect").
export type GuardingReaction = ActionOf<'block'> | ActionOf<'intercept'>

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

function canStepToGuard(state: SceneState, root: StrikeAction, guard: GuardingReaction): boolean {
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

// Whether the block or intercept can be made from the placement: an
// intercept within short range of the attacker, wherever it stands, a block
// made for someone else from the line.
export function isGuardPlacedAt(state: SceneState, root: StrikeAction, reaction: GuardingReaction, at: Placement): boolean {
  if (reaction.kind === 'block' && reaction.actorId !== root.targetId && !isOnProtectLine(state, root, reaction.actorId, at)) return false
  return reaction.kind !== 'intercept' || isInInterceptRange(state, root, reaction.actorId, at, reaction.weaponKey, reaction.attack)
}

// Whether the block or intercept stands where it may be made from. Anywhere,
// on a fight without a board.
export function isGuardPlaced(state: SceneState, root: StrikeAction, reaction: GuardingReaction): boolean {
  const here = state.board?.placements[reaction.actorId]
  return !here || isGuardPlacedAt(state, root, reaction, here)
}
