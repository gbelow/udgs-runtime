import type { Character, Grant } from '../../types'
import type { Action, Coord, MoveAction, SceneState, ShootAction, StrikeAction } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { makeAction } from '../factories'
import { hasGrant } from '../../character/rules/effects'
import { canAfford } from '../../character/rules/cost'
import { getAttackKind } from '../../weaponProperties'
import { SHOTS } from '../../tables'
import { isCampaignCharacter } from '../../utils'
import { getAction } from './log'
import { getFootprint, getMeleeThreateners, getPlacedFootprint, placeAt, withPlacements } from './board/board'
import { setDistance } from './board/geometry'
import { getMoveDestination, getMoveOrigin } from './board/waypoint'
import { getFreeAttackOptions, type AttackOption } from './attack'
import { getTargetIds } from './action'
import { getSurgeBarFor } from './surge'
import { isCombatStarted } from './started'
import { findWeaponRow } from './weaponRow'

// A jump of the actor's own, declared as one, that opens an attack from where
// it lands; the jump is a move like any other, priced as the ability says,
// and its attack is paid as any other.
// abilities.tex "Lunge": "Allows you to jump for 1 STA while using an attack
// as an action and attack from the final position. This movement triggers
// opportunity attacks and braced attacks normally."
// abilities.tex "Jump Shot": "Spends 1 extra AP and 1 STA to jump backward
// and perform a quick shot or throw, avoiding opportunity attacks if the jump
// takes them out of range." Backward is away from everyone who threatens the
// shooter (the table's ruling), at half the jump (combat.tex "Movement": "If
// performed backwards, the horizontal distance is halved"); the opportunity
// attacks its shot draws are those of whoever threatens where it lands.
type JumpAttack = { grant: Grant; price: ActionCost; opens: 'strike' | 'shoot'; backward: boolean }

export type JumpAttackKey = keyof MoveAction['modifiers']

export const JUMP_ATTACKS: Record<JumpAttackKey, JumpAttack> = {
  lunge: { grant: 'lunge', price: { AP: 0, STA: 1 }, opens: 'strike', backward: false },
  jumpShot: { grant: 'jumpShot', price: { AP: 1, STA: 1 }, opens: 'shoot', backward: true },
}

const KEYS = Object.keys(JUMP_ATTACKS) as JumpAttackKey[]

// The jump attack the move is declared as, if any.
function getDeclared(move: MoveAction): JumpAttackKey | null {
  return KEYS.find((key) => move.modifiers[key]) ?? null
}

// Whether the move may be declared as the jump attack: a jump of the actor's
// own in their action, by one who has learned it, declared as no other.
export function canJumpAttack(state: SceneState, move: MoveAction, key: JumpAttackKey): boolean {
  const c = state.characters[move.actorId]
  const other = getDeclared(move)
  return !!c && hasGrant(c, JUMP_ATTACKS[key].grant) && (other === null || other === key)
    && move.movement === 'jump' && move.spawnedBy === null && move.preparedPart === null && !move.forced
}

// The jump attack the move is, declared and open.
export function getJumpAttack(state: SceneState, move: MoveAction): JumpAttackKey | null {
  const key = getDeclared(move)
  return key && canJumpAttack(state, move, key) ? key : null
}

// Whether a jump attack may land on the cell: backward, if it must jump so,
// and from there some attack it opens that its actor can pay for, the jump's
// price besides, and that their surge lets them make, reaches someone they
// may attack. Any other move may land anywhere.
export function isJumpAttackLanding(state: SceneState, move: MoveAction, cell: Coord | undefined): boolean {
  const key = getDeclared(move)
  if (key === null) return true
  if (!canJumpAttack(state, move, key) || !cell) return false
  const { price, opens, backward } = JUMP_ATTACKS[key]
  const c = state.characters[move.actorId]
  const from = state.board?.placements[move.actorId]
  if (!c || !isCampaignCharacter(c) || getSurgeBarFor(state, c, opens) !== null) return false
  if (backward && !isBackward(state, move, cell)) return false
  const landed = from ? withPlacements(state, { [c.id]: placeAt(state.board, from, cell) }) : state
  const opened = getJumpAttackOpened(move, key, '')
  return getFreeAttackOptions(landed, c, opens).some((o) =>
    isOpenedRow(c, key, o)
    && canAfford(c, { AP: o.AP + price.AP, STA: o.STA + price.STA }, isCombatStarted(state))
    && getTargetIds(landed, { ...opened, weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }).length > 0)
}

// Whether landing on the cell takes the jumper further from everyone who
// threatens them where they set out.
function isBackward(state: SceneState, move: MoveAction, cell: Coord): boolean {
  const c = state.characters[move.actorId]
  const origin = getMoveOrigin(state, move)
  const end = getMoveDestination(state, move, [cell])
  if (!c || !origin || !end) return true
  const before = getFootprint(c, origin)
  const after = getFootprint(c, end)
  return getMeleeThreateners(state, move.actorId).every((id) => {
    const other = getPlacedFootprint(state, id)
    return !other || setDistance(after, other) > setDistance(before, other)
  })
}

// The attack a landed jump attack opens, from where it landed, for its actor
// to declare.
export function getJumpAttackOpened(move: MoveAction, key: JumpAttackKey, id: string): StrikeAction | ShootAction {
  return makeAction(JUMP_ATTACKS[key].opens, { id, actorId: move.actorId, spawnedBy: move.id })
}

// The jump attack that opened the action, if one did.
export function getOpeningJumpAttack(state: SceneState, action: Action): JumpAttackKey | null {
  const opener = (action.kind === 'strike' || action.kind === 'shoot') && action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return opener?.kind === 'move' ? getDeclared(opener) : null
}

// Whether the row and variation may be the attack the jump attack opens: a
// jump shot's is a quick shot or a throw.
export function isOpenedRow(c: Character, key: JumpAttackKey | null, o: Pick<AttackOption, 'weaponKey' | 'attack' | 'variant'>): boolean {
  if (key !== 'jumpShot') return true
  const row = findWeaponRow(c, o.weaponKey, o.attack)
  return o.variant === SHOTS.quickShot.variant || (!!row && getAttackKind(row.atk.range) === 'throw')
}
