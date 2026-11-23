import type { Character } from '../../types'
import type { Action, MoveAction, Placement, SceneState, ShootAction, StrikeAction } from '../types'
import { FALL } from '../../tables'
import { getMovementSpeed } from '../../character/rules/movement'
import { makeAction } from '../factories'
import { ROTATIONS, disk, sameCell, setDistance } from './board/geometry'
import { getFootprint, getMeleeThreateners, getPlacedFootprint, placeAt, withPlacements } from './board/board'
import { readGround } from './board/ground'
import { getJumpPath, isPathLegal } from './move'
import { getCombinedMoves, getCombinedOf, isOpenedRow, type CombinedEntry } from './combinedMove'
import { isFloorAttack } from './equipment'
import { getTargetIds } from './action'

// abilities.tex "Lunge": "Jumps toward the target before the attack and
// attacks from the final position. This movement triggers opportunity attacks
// and braced attacks normally." "Jump Shot": "Jumps backward and performs a
// quick shot or throw, avoiding opportunity attacks if the jump takes them out
// of range." Each is
// declared on the attack, as an evasive jump is on an evade (combat.tex
// "Evasive Jump"), its price added to the attack's, and the attack carries
// the jump before its die (RecipeSchema `combinedMove`, `with` an attack).
// The jump is half a jump, the evasive jump's length (combat.tex "Movement":
// "its distance is only half the jumping distance"), towards the
// target for a lunge (the table's ruling) and away from everyone threatening
// the shooter for a jump shot; it lands only where the attack then reaches
// its target, picked once the target is. Committed, the attack opens the jump
// as a move of its own, which draws what any move draws, and is made from
// where the jump ends.

export type JumpAttack = StrikeAction | ShootAction

export function isJumpAttack(action: Action): action is JumpAttack {
  return action.kind === 'strike' || action.kind === 'shoot'
}

// The jump the attack is declared with, as its actor has it; null for one
// declared with none.
export function getAttackJumpOf(state: SceneState, attack: JumpAttack): CombinedEntry | null {
  const entry = getCombinedOf(state.characters[attack.actorId], attack)
  return entry && (entry.recipe.with as readonly string[]).includes(attack.kind) ? entry : null
}

// Whether the attack may be declared with the jump: an attack of the actor's
// own on their turn, on the board, at a character, with a row the recipe
// allows, and, once the target is picked, with somewhere to land.
export function canCarryJump(state: SceneState, attack: JumpAttack, entry: CombinedEntry): boolean {
  const c = state.characters[attack.actorId]
  if (!c || !(entry.recipe.with as readonly string[]).includes(attack.kind)) return false
  if (attack.spawnedBy !== null || attack.reactionTo !== null || attack.preparedPart !== null || !state.board?.placements[c.id]) return false
  if (isFloorAttack(attack) || !isOpenedRow(c, entry, attack)) return false
  return attack.targetId === null || getJumpLandings(state, attack, entry).length > 0
}

// The attack as declared without its jump, made from wherever the attacker
// is put.
function withoutJump(attack: JumpAttack): JumpAttack {
  return { ...attack, recipe: null, jumpTo: null }
}

// Whether landing there takes the jump the way the recipe sends it: nearer
// the target, or further from everyone who threatens the jumper.
function isTheWay(state: SceneState, entry: CombinedEntry, attack: JumpAttack, from: Placement, to: Placement, targetId: string): boolean {
  const c = state.characters[attack.actorId]
  if (!c) return false
  const before = getFootprint(c, from)
  const after = getFootprint(c, to)
  switch (entry.recipe.toward) {
    case 'towardTarget': {
      const target = getPlacedFootprint(state, targetId)
      return !!target && setDistance(after, target) < setDistance(before, target)
    }
    case 'awayFromThreateners':
      return getMeleeThreateners(state, c.id).every((id) => {
        const other = getPlacedFootprint(state, id)
        return !other || setDistance(after, other) > setDistance(before, other)
      })
    case 'any':
      return true
    case 'towardAttacker':
      return false
  }
}

// How many metres the jump an attack carries goes, half a jump.
function getHop(c: Character): number {
  return Math.floor(getMovementSpeed(c, 'jump') / 2)
}

// How many metres nearer its target a jump could bring the attack, were it
// declared with one: a jump away from everyone brings it none.
export function getClosingHop(state: SceneState, attack: JumpAttack): number {
  const c = state.characters[attack.actorId]
  const closes = !!c && getCombinedMoves(c, attack.kind).some((e) => e.recipe.reach === 'halfJump' && (e.recipe.toward === 'towardTarget' || e.recipe.toward === 'any') && isOpenedRow(c, e, attack))
  return closes ? getHop(c) : 0
}

// Every place half a jump from where the attacker stands lands on, as a
// jump of theirs may go there, and not down a drop that would be a fall:
// one placement for each cell, turned as they stand where that lands.
function getHops(state: SceneState, attack: JumpAttack, entry: CombinedEntry): Placement[] {
  const c = state.characters[attack.actorId]
  const from = state.board?.placements[attack.actorId]
  const floor = from && readGround(state, attack.actorId)?.at(from.elevation)
  if (!c || !from || !floor) return []
  const hop = getHop(c)
  const turns = [from.orientation, ...ROTATIONS.filter((o) => o !== from.orientation)]
  return disk(from.cell, hop).flatMap((cell) => {
    if (sameCell(cell, from.cell) || floor.elevation(from.cell) - floor.elevation(cell) >= FALL.minHeight) return []
    const to = turns.map((orientation) => ({ ...placeAt(state.board, from, cell), orientation })).find((p) => isPathLegal(state, getJumpMove(attack, entry, from, p, '')))
    return to ? [to] : []
  })
}

// The jump to the place, as the move the attack opens.
function getJumpMove(attack: JumpAttack, entry: CombinedEntry, from: Placement, to: Placement, id: string): MoveAction {
  return makeAction('move', { id, actorId: attack.actorId, spawnedBy: attack.id || null, movement: 'jump', movements: ['jump'], path: getJumpPath(from.cell, to.cell), orientation: to.orientation, recipe: entry.id })
}

// Where the jump may land, for the attack at its target.
export function getJumpLandings(state: SceneState, attack: JumpAttack, entry: CombinedEntry): Placement[] {
  const from = state.board?.placements[attack.actorId]
  const targetId = attack.targetId
  if (!from || !targetId) return []
  const plain = withoutJump(attack)
  return getHops(state, attack, entry).filter((to) => isTheWay(state, entry, attack, from, to, targetId) && getTargetIds(withPlacements(state, { [attack.actorId]: to }), plain).includes(targetId))
}

// The fight as the attack is declared from where its jump lands: the
// attacker stood there, to see what they reach and at what penalty.
export function getJumpingState(state: SceneState, attack: JumpAttack): SceneState {
  if (attack.step !== 'define' || !attack.jumpTo || !getAttackJumpOf(state, attack)) return state
  return withPlacements(state, { [attack.actorId]: attack.jumpTo })
}

// Who the attack declared with a jump may be aimed at while it is declared:
// from where the jump lands, or before that is picked, from any place it
// could, that way; null for any other attack.
export function getJumpTargets(state: SceneState, attack: JumpAttack): string[] | null {
  const entry = attack.step === 'define' ? getAttackJumpOf(state, attack) : null
  const from = state.board?.placements[attack.actorId]
  if (!entry || !from) return null
  const plain = withoutJump(attack)
  const landings = attack.jumpTo ? [attack.jumpTo] : getHops(state, attack, entry)
  const ids = landings.flatMap((to) => getTargetIds(withPlacements(state, { [attack.actorId]: to }), plain).filter((id) => isTheWay(state, entry, attack, from, to, id)))
  return [...new Set(ids)]
}

// Whether the jump the attack is declared with lands where it may.
export function isJumpLanded(state: SceneState, attack: JumpAttack): boolean {
  const entry = attack.step === 'define' ? getAttackJumpOf(state, attack) : null
  if (!entry) return true
  const to = attack.jumpTo
  return to !== null && getJumpLandings(state, attack, entry).some((p) => sameCell(p.cell, to.cell) && p.orientation === to.orientation)
}

// The jump the committed attack opens, to be made before its die.
export function openAttackJump(state: SceneState, attack: JumpAttack, id: string): MoveAction | null {
  const entry = getAttackJumpOf(state, attack)
  const from = state.board?.placements[attack.actorId]
  return entry && from && attack.jumpTo ? getJumpMove(attack, entry, from, attack.jumpTo, id) : null
}
