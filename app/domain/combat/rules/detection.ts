import type { Character, Senses } from '../../types'
import type { Action, Board, CombatState, Coord, Direction } from '../types'
import { BAD_VISIBILITY_PENALTY, FOG_VISION_RADIUS } from '../../tables'
import { getDetectionTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getSenseBonus } from '../../character/lenses/senses'
import { getAfflictedSense } from '../../character/rules/afflictions'
import { getCamouflage } from '../../item/rules/items'
import { getSituationalAfflictions } from './situational'
import { directionTo, parseCoordKey, sameCell, setDistance } from '../geometry'
import { getDistanceBetween, getPlacedFootprint, hasLineOfSight } from './board'
import { getCellHazard, getHazardAt, getHazardOf } from './hazard'
import { getPartners } from './partners'
import { getMoveOrigin } from './waypoint'
import { isUnlit } from './light'
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

// combat.tex "Vision": how much of what stands on `at` an eye on `from`
// takes in, the ground between aside. "Darkness and light": "Anyone in the
// light radius is visible and anyone out is not"; "Visibility": bad
// visibility is partial, none is nothing to target; "Fog and smoke": whoever
// stands in it sees no further than its radius, and others inside within it
// are in bad visibility.
function seeInto(state: CombatState, from: Coord[], at: Coord[]): Impairment {
  if (at.every((cell) => isUnlit(state, cell))) return 'total'
  const near = setDistance(from, at) <= FOG_VISION_RADIUS
  const inFog = getHazardAt(state, from).visibility === 'zero'
  const there = getHazardAt(state, at).visibility
  if (there === 'zero') return inFog && near ? 'partial' : 'total'
  if (inFog && !near) return 'total'
  return there === 'bad' ? 'partial' : 'none'
}

// combat.tex "Sensory impairment": how much of the target a sense takes in
// from where each stands, one entry per sense so that a new sense does not
// compile until it says. None detects outright, partial needs a detection
// test against the stealth value, total takes nothing in.
const IMPAIRMENTS: Record<keyof Senses, Impair> = {
  // combat.tex "Vision": "requires light and line of sight"; "Cover": out of
  // line of sight is total impairment; a camouflaged target is in bad
  // visibility
  vision: (state, o, t) => {
    if (!hasLineOfSight(state, o, t)) return 'total'
    const from = getPlacedFootprint(state, o)
    const at = getPlacedFootprint(state, t)
    const seen = from && at ? seeInto(state, from, at) : 'none'
    return seen === 'none' && isCamouflaged(state, t) ? 'partial' : seen
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

// combat.tex "Camouflage": "an item necessary to turn an area into a stealth
// area with bad visibility for a camouflaged character" — whether the
// character carries one. Matching it to the ground is the table's to judge.
function isCamouflaged(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  return !!c && getCamouflage(c) !== null
}

// combat.tex "Afflictions": "Blind: ... Cannot use vision", "Deaf: ... Cannot
// use hearing".
function canUse(state: CombatState, c: Character, sense: keyof Senses): boolean {
  return c.senses[sense].hasSense && !getAfflictedSense(c, sense, getSituationalAfflictions(state, c.id)).lost
}

// Ground that totally impairs a sense of whoever looks into it: fog and smoke,
// dark ground no light reaches. Walls are not such ground.
function isBlindingGround(state: CombatState, cell: Coord): boolean {
  return isUnlit(state, cell) || getCellHazard(state, cell).visibility === 'zero'
}

type TotalInto = (state: CombatState, from: Coord[], at: Coord[], range: number | null) => boolean

const isBeyond: TotalInto = (_, from, at, range) => range !== null && setDistance(from, at) > range

// Whether the sense, from where the observer stands, takes in nothing of
// whoever stood on `at` — `IMPAIRMENTS` of a place rather than a target,
// line of sight left out.
const TOTAL_INTO: Record<keyof Senses, TotalInto> = {
  vision: (state, from, at) => seeInto(state, from, at) === 'total',
  hearing: () => false,
  smell: isBeyond,
  touch: isBeyond,
  synesthesia: isBeyond,
}

// combat.tex "Morale", "Sensory limitation": whether there is ground within
// `radius` metres of the character that every active sense they can use is
// totally impaired into. Only painted ground can be such; off the board,
// none is.
export function isNearBlindGround(state: CombatState, id: string, radius: number): boolean {
  const c = state.characters[id]
  const from = getPlacedFootprint(state, id)
  const terrain = state.board?.terrain
  if (!c || !from || !terrain) return false
  const senses = (Object.keys(TOTAL_INTO) as (keyof Senses)[]).filter((s) => c.senses[s].active && canUse(state, c, s))
  return Object.keys(terrain).some((key) => {
    const cell = parseCoordKey(key)
    return !!cell && setDistance(from, [cell]) <= radius && isBlindingGround(state, cell)
      && senses.every((s) => TOTAL_INTO[s](state, from, [cell], c.senses[s].range))
  })
}

// The sensory penalty of relying on a sense, a positive magnitude: its own
// (combat.tex "Senses": "Sensory penalty -3, by default") and what
// afflictions add to it ("Offuscated: -3 to sensory penalties when using
// vision").
export function getSensePenalty(state: CombatState, c: Character, sense: keyof Senses): number {
  return c.senses[sense].penalty + getAfflictedSense(c, sense, getSituationalAfflictions(state, c.id)).penalty
}

export type SenseReach = { sense: keyof Senses; active: boolean; reactive: boolean; impairment: Exclude<Impairment, 'total'>; terms: Term[]; detection: number }

// combat.tex "Detection": "A character adds the value of their best available
// sense to awareness in detection tests. Any sensory penalties to a sense are
// added too": the skill, the sense's own bonus, what afflictions take off it
// and, for vision partly impaired, the bad visibility it is impaired by — the
// ground's, or the camouflage's degree, whichever hides the target better.
// The sense's own penalty is not among them: it weighs on what is done
// relying on it (the table's ruling). Combat keeps no distance bands.
function getDetectionTermsThrough(state: CombatState, observer: Character, targetId: string, sense: keyof Senses, impairment: Impairment): Term[] {
  return [
    ...getDetectionTerms(observer),
    { label: sense, value: getSenseBonus(observer, sense) },
    { label: 'afflictions', value: -getAfflictedSense(observer, sense, getSituationalAfflictions(state, observer.id)).penalty },
    { label: 'visibility', value: sense === 'vision' && impairment === 'partial' ? getVisibilityTerm(state, targetId) : 0 },
  ]
}

// The bad visibility a partly seen target is in: the ground's, or the
// degree of their camouflage, whichever is the worse for the observer.
function getVisibilityTerm(state: CombatState, targetId: string): number {
  const target = state.characters[targetId]
  const camouflage = target ? getCamouflage(target) : null
  const ground = getHazardOf(state, targetId).visibility
  const sources = [...(ground === 'bad' || ground === 'zero' ? [BAD_VISIBILITY_PENALTY] : []), ...(camouflage === null ? [] : [-camouflage])]
  return sources.length === 0 ? 0 : Math.min(...sources)
}

// Every sense of the observer that takes the target in at all, with how
// impaired it is and what it detects at. Empty for an observer or target not
// in the fight, and for oneself.
export function getSenseReaches(state: CombatState, observerId: string, targetId: string): SenseReach[] {
  const observer = state.characters[observerId]
  if (!observer || !state.characters[targetId] || observerId === targetId) return []
  return (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).flatMap((sense) => {
    if (!canUse(state, observer, sense)) return []
    const { active, reactive, range } = observer.senses[sense]
    const impairment = IMPAIRMENTS[sense](state, observerId, targetId, range)
    if (impairment === 'total') return []
    const terms = getDetectionTermsThrough(state, observer, targetId, sense, impairment)
    return [{ sense, active, reactive, impairment, terms, detection: sumTerms(terms) }]
  })
}
