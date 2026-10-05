import type { Senses } from '../../types'
import type { Action, Board, CombatState, Coord, Direction } from '../types'
import { BAD_VISIBILITY_PENALTY, FOG_VISION_RADIUS } from '../../tables'
import { getDetectionTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getSenseBonus } from '../../character/lenses/senses'
import { DIRECTIONS, angleBetween, angularGap, directionTo, sameCell, toPlane } from '../geometry'
import { getDistanceBetween, getPlacedFootprint, hasLineOfSight } from './board'
import { getHazardOf } from './hazard'
import { getPartners } from './partners'
import { getMoveOrigin } from './waypoint'
import { getAction } from './log'

// combat.tex "Detection": what an observer's senses reach of a target, and
// how well. Nothing here compares against a stealth value; it answers which
// senses can take in the target at all and what detection each brings.
// Like every board rule, a fight without a board reaches everything.

// combat.tex "Vision": "The field of vision covers 180 degrees, which is
// defined in the grid as within the arc defined by the directions of 3 adjacent
// hexes around a character" — the facing and the two next to it, so every cell
// up to a quarter turn from the facing, the edge included. A cell of the
// observer's footprint that the target shares sees it.
function isInFieldOfVision(state: CombatState, observerId: string, targetId: string): boolean {
  const placement = state.board?.placements[observerId]
  const from = getPlacedFootprint(state, observerId)
  const to = getPlacedFootprint(state, targetId)
  if (!placement || !from || !to) return true
  const heading = angleBetween({ x: 0, y: 0 }, toPlane(DIRECTIONS[placement.orientation]))
  return from.some((a) => to.some((b) => sameCell(a, b) || angularGap(heading, angleBetween(toPlane(a), toPlane(b))) <= Math.PI / 2 + 1e-9))
}

const TARGETED_KINDS: readonly Action['kind'][] = ['strike', 'shoot', 'grapple', 'feint', 'cast']

// The cell a landed action leaves its actor looking at: where a throw went,
// whoever a reaction answers, whoever an attack, grapple, feint or cast
// (when it has a target) was aimed at.
function getLookedAt(state: CombatState, action: Action, board: Board): Coord | null {
  if (action.kind === 'throw') return action.to
  const target = action.reactionTo ? getAction(state, action.reactionTo)?.actorId : TARGETED_KINDS.includes(action.kind) ? action.targetId : null
  return (target && board.placements[target]?.cell) || null
}

// The way a landed action leaves its actor facing: along the last step of a
// move, otherwise towards what they looked at. Null where there is no
// direction (no step, nothing looked at, the same cell).
export function getActionHeading(state: CombatState, action: Action, board: Board): Direction | null {
  const here = board.placements[action.actorId]?.cell
  if (!here) return null
  if (action.kind === 'move') {
    const path = action.facts?.path ?? []
    const before = path[path.length - 2] ?? getMoveOrigin(state, action)?.cell
    const last = path[path.length - 1]
    return before && last && !sameCell(before, last) ? directionTo(before, last) : null
  }
  const there = getLookedAt(state, action, board)
  return there && !sameCell(here, there) ? directionTo(here, there) : null
}

type Reaches =(state: CombatState, observerId: string, targetId: string) => boolean

// Whether a sense takes the target in from where each stands, one entry per
// sense so that a new sense does not compile until it says.
const REACHES: Record<keyof Senses, Reaches> = {
  // combat.tex "Vision": "gets blocked by cover and requires light" (everything
  // is lit); combat.tex "Visibility": zero visibility "is untargetable through
  // vision"; combat.tex "Fog and smoke": whoever stands in it sees no further than 2m
  vision: (state, o, t) => {
    const distance = getDistanceBetween(state, o, t)
    const blinded = getHazardOf(state, o).visibility === 'zero' && distance !== null && distance > FOG_VISION_RADIUS
    return !blinded && hasLineOfSight(state, o, t) && isInFieldOfVision(state, o, t) && getHazardOf(state, t).visibility !== 'zero'
  },
  // combat.tex "Hearing": "omnidirectional"
  hearing: () => true,
  // combat.tex "Smell": "requires a smell trail to trigger the sense"; nothing leaves one yet
  smell: () => false,
  // combat.tex "Touch": "Anything that touches a character is immediately detected"
  touch: (state, o, t) => getPartners(state, o).includes(t),
  // abilities.tex: the sense reaches as far as its ability's radius, which nothing models yet
  synesthesia: () => false,
}

export type SenseReach = { sense: keyof Senses; active: boolean; terms: Term[]; detection: number }

// The terms of the observer's detection through one sense against the target:
// the skill, the sense's own bonus and, for vision, the penalty of a target in
// bad visibility. Combat keeps no distance bands.
export function getDetectionTermsThrough(state: CombatState, observerId: string, targetId: string, sense: keyof Senses): Term[] {
  const observer = state.characters[observerId]
  if (!observer) return []
  return [
    ...getDetectionTerms(observer),
    { label: sense, value: getSenseBonus(observer, sense) },
    { label: 'visibility', value: sense === 'vision' && getHazardOf(state, targetId).visibility === 'bad' ? BAD_VISIBILITY_PENALTY : 0 },
  ]
}

// Every sense of the observer that reaches the target, with what it detects
// at. Empty for an observer or target not in the fight, and for oneself.
export function getSenseReaches(state: CombatState, observerId: string, targetId: string): SenseReach[] {
  const observer = state.characters[observerId]
  if (!observer || !state.characters[targetId] || observerId === targetId) return []
  return (Object.keys(REACHES) as (keyof Senses)[])
    .filter((sense) => observer.senses[sense].hasSense && REACHES[sense](state, observerId, targetId))
    .map((sense) => {
      const terms = getDetectionTermsThrough(state, observerId, targetId, sense)
      return { sense, active: observer.senses[sense].active, terms, detection: sumTerms(terms) }
    })
}
