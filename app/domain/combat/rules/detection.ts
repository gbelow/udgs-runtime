import type { Character, Senses } from '../../types'
import type { Action, Board, CombatState, Coord, Direction } from '../types'
import { BAD_VISIBILITY_PENALTY, FOG_VISION_RADIUS } from '../../tables'
import { getDetectionTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getSenseBonus } from '../../character/lenses/senses'
import { hasAffliction } from '../../character/rules/afflictions'
import { directionTo, sameCell } from '../geometry'
import { getDistanceBetween, hasLineOfSight } from './board'
import { getHazardOf } from './hazard'
import { getPartners } from './partners'
import { getMoveOrigin } from './waypoint'
import { getAction } from './log'

// combat.tex "Detection": what an observer's senses take in of a target, and
// how well. Nothing here compares against a stealth value; it answers how
// impaired each sense is and what detection each brings.
// Like every board rule, a fight without a board reaches everything.

const TARGETED_KINDS: readonly Action['kind'][] = ['strike', 'shoot', 'grapple', 'feint', 'cast']

// combat.tex dropped facing from vision; a one-cell token still turns the
// way it acted, for the board to draw.

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

export type Impairment = 'none' | 'partial' | 'total'

type Impair = (state: CombatState, observerId: string, targetId: string, range: number | null) => Impairment

// A sense that reaches as far as its range: null for no limit, 0 for what it
// touches, a grapple partner.
const byRange: Impair = (state, o, t, range) => {
  if (range === null) return 'none'
  if (range === 0) return getPartners(state, o).includes(t) ? 'none' : 'total'
  const distance = getDistanceBetween(state, o, t)
  return distance === null || distance <= range ? 'none' : 'total'
}

// combat.tex "Sensory impairment": how much of the target a sense takes in
// from where each stands, one entry per sense so that a new sense does not
// compile until it says. None detects outright, partial needs a detection
// test against the stealth value, total takes nothing in.
const IMPAIRMENTS: Record<keyof Senses, Impair> = {
  // combat.tex "Vision": "requires light and line of sight" (everything is
  // lit); "Cover": out of line of sight is total impairment; "Visibility": bad
  // visibility is partial, none is nothing to target; "Fog and smoke": whoever
  // stands in it sees no further than its radius, and others inside within it
  // are in bad visibility
  vision: (state, o, t) => {
    if (!hasLineOfSight(state, o, t)) return 'total'
    const distance = getDistanceBetween(state, o, t)
    const near = distance === null || distance <= FOG_VISION_RADIUS
    const inFog = getHazardOf(state, o).visibility === 'zero'
    const there = getHazardOf(state, t).visibility
    if (there === 'zero') return inFog && near ? 'partial' : 'total'
    if (inFog && !near) return 'total'
    return there === 'bad' ? 'partial' : 'none'
  },
  // combat.tex "Hearing": "triggered by a sound event"; nothing on the board
  // muffles one yet
  hearing: () => 'none',
  // combat.tex "Smell": "Range of smell is 0, by default"
  smell: byRange,
  // combat.tex "Touch": "an active and reactive sense with 0m range"
  touch: byRange,
  synesthesia: byRange,
}

// combat.tex "Afflictions": "Blind: ... Cannot use vision", "Deaf: ... Cannot
// use hearing".
function canUse(c: Character, sense: keyof Senses): boolean {
  if (!c.senses[sense].hasSense) return false
  if (sense === 'vision') return !hasAffliction(c, 'blind')
  if (sense === 'hearing') return !hasAffliction(c, 'deaf')
  return true
}

export type SenseReach = { sense: keyof Senses; active: boolean; reactive: boolean; impairment: Exclude<Impairment, 'total'>; terms: Term[]; detection: number }

// combat.tex "Detection": "A character adds the value of their best available
// sense to awareness in detection tests. Any sensory penalties to a sense are
// added too": the skill, the sense's own bonus and, for vision partly
// impaired, the bad visibility it is impaired by. The sense's own penalty is
// not among them: it weighs on what is done relying on it (the table's
// ruling). Combat keeps no distance bands.
function getDetectionTermsThrough(observer: Character, sense: keyof Senses, impairment: Impairment): Term[] {
  return [
    ...getDetectionTerms(observer),
    { label: sense, value: getSenseBonus(observer, sense) },
    { label: 'visibility', value: sense === 'vision' && impairment === 'partial' ? BAD_VISIBILITY_PENALTY : 0 },
  ]
}

// Every sense of the observer that takes the target in at all, with how
// impaired it is and what it detects at. Empty for an observer or target not
// in the fight, and for oneself.
export function getSenseReaches(state: CombatState, observerId: string, targetId: string): SenseReach[] {
  const observer = state.characters[observerId]
  if (!observer || !state.characters[targetId] || observerId === targetId) return []
  return (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).flatMap((sense) => {
    if (!canUse(observer, sense)) return []
    const { active, reactive, range } = observer.senses[sense]
    const impairment = IMPAIRMENTS[sense](state, observerId, targetId, range)
    if (impairment === 'total') return []
    const terms = getDetectionTermsThrough(observer, sense, impairment)
    return [{ sense, active, reactive, impairment, terms, detection: sumTerms(terms) }]
  })
}
