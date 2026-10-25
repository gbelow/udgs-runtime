import type { Action, Coord, MoveAction, SceneState, StrikeAction } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { makeAction } from '../factories'
import { hasGrant } from '../../character/rules/effects'
import { canAfford } from '../../character/rules/cost'
import { isCampaignCharacter } from '../../utils'
import { getAction } from './log'
import { placeAt, withPlacements } from './board/board'
import { getFreeAttackOptions } from './attack'
import { getTargetIds } from './action'
import { getSurgeBarFor } from './surge'
import { isCombatStarted } from './started'

// abilities.tex "Lunge": "Allows you to jump for 1 STA while using an attack
// as an action and attack from the final position. This movement triggers
// opportunity attacks and braced attacks normally." A lunge is a jump of the
// actor's own, declared as one, that opens the strike from where it lands;
// the jump is a move like any other, and its strike is paid as any other.

export const LUNGE_COST: ActionCost = { AP: 0, STA: 1 }

// Whether the move may be declared as a lunge: a jump of the actor's own in
// their action, by one who has learned it.
export function canLunge(state: SceneState, move: MoveAction): boolean {
  const c = state.characters[move.actorId]
  return !!c && hasGrant(c, 'lunge') && move.movement === 'jump' && move.spawnedBy === null && move.preparedPart === null && !move.forced
}

export function isLunge(state: SceneState, move: MoveAction): boolean {
  return move.lunge && canLunge(state, move)
}

// Whether a lunge may land on the cell: from there some strike its actor can
// pay for, the jump's STA besides, and that their surge lets them make,
// reaches someone they may attack. Any other move may land anywhere.
export function isLungeLanding(state: SceneState, move: MoveAction, cell: Coord | undefined): boolean {
  if (!move.lunge) return true
  if (!canLunge(state, move) || !cell) return false
  const c = state.characters[move.actorId]
  const from = state.board?.placements[move.actorId]
  if (!c || !isCampaignCharacter(c) || getSurgeBarFor(state, c, 'strike') !== null) return false
  const landed = from ? withPlacements(state, { [c.id]: placeAt(state.board, from, cell) }) : state
  const strike = getLungeStrike(move, '')
  return getFreeAttackOptions(landed, c, 'strike').some((o) =>
    canAfford(c, { AP: o.AP, STA: o.STA + LUNGE_COST.STA }, isCombatStarted(state))
    && getTargetIds(landed, { ...strike, weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }).length > 0)
}

// The strike a landed lunge opens, from where it landed, for its actor to
// declare.
export function getLungeStrike(move: MoveAction, id: string): StrikeAction {
  return makeAction('strike', { id, actorId: move.actorId, spawnedBy: move.id })
}

// Whether the strike was opened by a lunge.
export function isLungeStrike(state: SceneState, action: Action): boolean {
  const opener = action.kind === 'strike' && action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return opener?.kind === 'move' && opener.lunge
}
