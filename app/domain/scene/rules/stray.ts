import type { Coord, SceneState, ShootAction, Stray } from '../types'
import { sumTerms } from '../../character/rules/terms'
import { isDead } from '../../character/rules/afflictions'
import { getDegree } from '../../play/test'
import { makeAction } from '../factories'
import { DIRECTIONS, add, directionTo, inExtent, sameCell, turn } from './board/geometry'
import { getFootprint, getPlacedFootprint, getTerrainAt, getTerrainReader, isLevelWith, isStepWalled } from './board/board'
import { getGroundCell, isWorthHitting } from './floorAttack'
import { getDefaultAim, getDLTerms } from './attack'
import { pickShotDeclaration } from './declaration'
import { isVoided } from './opportunity'

// combat.tex "Immobile Targets and Shooting Errors": "If a projectile scores
// under 0 on its test, it hits another space. Pick any direction randomly from
// the target. Hit anywhere within a d6 radius". The user's rulings
// (2026-11-28): every shot that misses goes astray, a guarded one too; one d6
// for how far, one for which way (1 on along the line of fire, the others
// clockwise from it), one for its score against whoever it reaches; a wall
// stops it and it stays on its floor; with no board there is nowhere for it
// to go. The shot it becomes lands as any shot would there.

// Whether the shot, as it lands, goes astray: a miss on a board that was
// fired, and not itself one gone astray.
export function goesAstray(state: SceneState, shot: ShootAction): boolean {
  return state.board !== null && shot.strayOf === null && shot.roll?.degree === 'miss' && !isVoided(state, shot)
}

// Where the shot goes, `distance` spaces out from the target's edge the way
// `direction` says, level with the target's floor; stopped in the last space
// before a wall, ground that rises off its floor or the board's edge. Null
// when it can go nowhere, or there is no target to go from.
export function getStrayLanding(state: SceneState, shot: ShootAction, distance: number, direction: number): Pick<Stray, 'cell' | 'floor'> | null {
  const board = state.board
  const from = board?.placements[shot.actorId]
  if (!board || !from) return null
  const target = shot.targetId ? board.placements[shot.targetId] : null
  const ground = target ? null : getGroundCell(state, shot)
  const anchor = target?.cell ?? ground
  const origin = shot.targetId && target ? getPlacedFootprint(state, shot.targetId) : ground ? [ground] : null
  if (!anchor || !origin) return null
  const floor = target ? target.elevation : getTerrainAt(board, anchor, from.elevation).floor
  const step = DIRECTIONS[turn(directionTo(from.cell, anchor), direction - 1)]
  const at = getTerrainReader(board, floor)
  let cursor = anchor
  let stop: Coord | null = null
  for (let gone = 0; gone < distance;) {
    const next = add(cursor, step)
    if (origin.some((c) => sameCell(c, next))) {
      cursor = next
      continue
    }
    const footing = at(next)
    if (!inExtent(board.origin, board.extent, next) || footing.terrain?.blocking || !isLevelWith(floor, footing.floor) || isStepWalled((c) => at(c).terrain, cursor, next)) break
    cursor = next
    stop = next
    gone++
  }
  return stop ? { cell: stop, floor } : null
}

// Who stands in the space the shot went to, on its floor, alive.
function getStruckThere(state: SceneState, stray: Stray): string | null {
  const board = state.board
  if (!board) return null
  return Object.entries(board.placements).find(([id, placement]) => {
    const c = state.characters[id]
    return c && !isDead(c) && isLevelWith(stray.floor, placement.elevation) && getFootprint(c, placement).some((cell) => sameCell(cell, stray.cell))
  })?.[0] ?? null
}

// The shot the missed one becomes where it went: at whoever stands there, else
// at an object lying there that a hit would do something to, else at the
// ground; made with the same row and ammunition, scored with its d6 against
// what is there, and opened rolled, for nobody to answer.
export function getStrayShot(state: SceneState, missed: ShootAction, id: string): ShootAction | null {
  const stray = missed.astray
  if (!stray || missed.strayOf !== null) return null
  const base = makeAction('shoot', { id, actorId: missed.actorId, ...pickShotDeclaration(missed), spawnedBy: missed.id, strayOf: missed.id, breakRolls: missed.breakRolls, step: 'post' })
  const struck = getStruckThere(state, stray)
  const object = struck ? undefined : state.floor.find((f) => f.cell && sameCell(f.cell, stray.cell) && isWorthHitting(state, { ...base, cell: stray.cell }, f))
  const aimed: ShootAction = struck ? { ...base, targetId: struck, ...getDefaultAim(state.characters[struck]) }
    : object ? { ...base, object: object.item.id }
    : { ...base, cell: stray.cell }
  const DLTerms = getDLTerms(state, aimed)
  const DL = sumTerms(DLTerms)
  return { ...aimed, roll: { die: stray.score, DL, score: stray.score, degree: getDegree(stray.score, DL), HOP: 0, skillTerms: [], DLTerms } }
}
