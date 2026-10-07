import type { CampaignCharacter, Character, Senses, Skills } from '../../types'
import type { Action, Board, CombatState, Coord, Direction } from '../types'
import { BAD_VISIBILITY_PENALTY, FOG_VISION_RADIUS, SkillPenaltyTable } from '../../tables'
import { getDetectionTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getSenseBonus } from '../../character/lenses/senses'
import { getAfflictedSense } from '../../character/rules/afflictions'
import { getCamouflage } from '../../item/rules/items'
import { getSituationalAfflictions } from './situational'
import { directionTo, disk, parseCoordKey, sameCell, setDistance } from '../geometry'
import { getDistanceBetween, getPlacedFootprint, hasLineOfSight, seesAcross } from './board'
import { getCellHazard, getHazardAt } from './hazard'
import { getPartners } from './partners'
import { getMoveOrigin } from './waypoint'
import { getLightAt, isUnlit, seesInDimLight } from './light'
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
// light radius is visible and anyone out is not. Dim light means partial
// impairment", unless the eye sees clearly in it; "Visibility": bad
// visibility is partial, none is nothing to target; "Fog and smoke": whoever
// stands in it sees no further than its radius, and others inside within it
// are in bad visibility.
function seeInto(state: CombatState, from: Coord[], at: Coord[], dimSighted: boolean): Impairment {
  const light = getLightAt(state, at)
  if (light === 'dark') return 'total'
  const near = setDistance(from, at) <= FOG_VISION_RADIUS
  const inFog = getHazardAt(state, from).visibility === 'zero'
  const there = getHazardAt(state, at).visibility
  if (there === 'zero') return inFog && near ? 'partial' : 'total'
  if (inFog && !near) return 'total'
  return there === 'bad' || (light === 'dim' && !dimSighted) ? 'partial' : 'none'
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
    const observer = state.characters[o]
    const seen = from && at ? seeInto(state, from, at, !!observer && seesInDimLight(observer)) : 'none'
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
  vision: (state, from, at) => seeInto(state, from, at, false) === 'total',
  hearing: () => false,
  smell: isBeyond,
  touch: isBeyond,
  synesthesia: isBeyond,
}

// combat.tex "Morale", "Sensory limitation": whether there is ground within
// `radius` metres of the character that every active sense they can use is
// totally impaired into. Only painted ground can be such, or any ground on a
// dark board; off the board, none is.
export function isNearBlindGround(state: CombatState, id: string, radius: number): boolean {
  const c = state.characters[id]
  const from = getPlacedFootprint(state, id)
  const terrain = state.board?.terrain
  if (!c || !from || !terrain) return false
  const senses = (Object.keys(TOTAL_INTO) as (keyof Senses)[]).filter((s) => c.senses[s].active && canUse(state, c, s))
  const cells = state.board?.light === 'dark' ? from.flatMap((at) => disk(at, radius)) : Object.keys(terrain).flatMap((key) => parseCoordKey(key) ?? [])
  return cells.some((cell) => setDistance(from, [cell]) <= radius && isBlindingGround(state, cell)
    && senses.every((s) => TOTAL_INTO[s](state, from, [cell], c.senses[s].range)))
}

// What an observer's sense is aimed at: a character, or cells of the ground.
export type Toward = string | readonly Coord[]

// combat.tex "Sensory Penalties": "Apply when acting under bad sensory
// conditions ... The penalties add up": the sense's own ("Senses":
// "Sensory penalty -3, by default"), what afflictions add to it
// ("Offuscated: -3 to sensory penalties when using vision") and, for vision
// partly impaired, the bad visibility it is impaired by ("Visibility": "a
// sensory penalty when targeting anything there").
function getSensoryTermsOf(state: CombatState, observer: CampaignCharacter, toward: Toward, sense: keyof Senses, impairment: Impairment): Term[] {
  return [
    { label: `${sense} penalty`, value: -observer.senses[sense].penalty },
    { label: 'afflictions', value: -getAfflictedSense(observer, sense, getSituationalAfflictions(state, observer.id)).penalty },
    { label: 'visibility', value: sense === 'vision' && impairment === 'partial' ? getVisibilityTerm(state, observer, toward) : 0 },
  ]
}

// combat.tex "Detection": "A character adds the value of their best available
// sense to awareness in detection tests. Any sensory penalties to a sense are
// added too": the skill, the sense's own bonus and its sensory penalty.
function getDetectionTermsThrough(state: CombatState, observer: CampaignCharacter, targetId: string, sense: keyof Senses, impairment: Impairment): Term[] {
  return [
    ...getDetectionTerms(observer),
    { label: sense, value: getSenseBonus(observer, sense) },
    ...getSensoryTermsOf(state, observer, targetId, sense, impairment),
  ]
}

// The bad visibility a partly seen target is in: the ground's or the dim
// light's, or the degree of their camouflage, whichever is the worse for the
// observer.
function getVisibilityTerm(state: CombatState, observer: CampaignCharacter, toward: Toward): number {
  const target = typeof toward === 'string' ? state.characters[toward] : undefined
  const at = typeof toward === 'string' ? getPlacedFootprint(state, toward) ?? [] : [...toward]
  const camouflage = target ? getCamouflage(target) : null
  const ground = getHazardAt(state, at).visibility
  const dim = getLightAt(state, at) === 'dim' && !seesInDimLight(observer)
  const sources = [...(ground === 'bad' || ground === 'zero' || dim ? [BAD_VISIBILITY_PENALTY] : []), ...(camouflage === null ? [] : [-camouflage])]
  return sources.length === 0 ? 0 : Math.min(...sources)
}

// How much of cells of the ground a sense of the observer takes in from where
// they stand: `IMPAIRMENTS` of a place, line of sight kept.
function getImpairmentInto(state: CombatState, observer: CampaignCharacter, from: Coord[], at: Coord[], sense: keyof Senses): Impairment {
  if (sense !== 'vision') return TOTAL_INTO[sense](state, from, at, observer.senses[sense].range) ? 'total' : 'none'
  if (state.board && !seesAcross(state.board, from, at)) return 'total'
  return seeInto(state, from, at, seesInDimLight(observer))
}

function getImpairment(state: CombatState, observer: CampaignCharacter, toward: Toward, sense: keyof Senses): Impairment {
  if (typeof toward === 'string') return IMPAIRMENTS[sense](state, observer.id, toward, observer.senses[sense].range)
  const from = getPlacedFootprint(state, observer.id)
  return from && toward.length > 0 ? getImpairmentInto(state, observer, from, [...toward], sense) : 'none'
}

export type SensoryPenalty = { sense: keyof Senses; penalty: number }

// combat.tex "Targeted actions": "Any actions that use any of the skills
// listed in sensory penalties require a sense to be used. They always use the
// best one available" — the least penalised sense of the kind the use calls
// for ("Active senses: are used to perform any action. Reactive senses can be
// used for reactions") that takes in what it is aimed at, and its sensory
// penalty as a positive magnitude. Null where no such sense takes it in.
export function getSensoryPenalty(state: CombatState, actorId: string, toward: Toward, use: 'active' | 'reactive'): SensoryPenalty | null {
  const c = state.characters[actorId]
  if (!c || toward === actorId) return null
  return (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).reduce<SensoryPenalty | null>((best, sense) => {
    if (!c.senses[sense][use] || !canUse(state, c, sense)) return best
    const impairment = getImpairment(state, c, toward, sense)
    if (impairment === 'total') return best
    const penalty = -sumTerms(getSensoryTermsOf(state, c, toward, sense, impairment))
    return best && best.penalty <= penalty ? best : { sense, penalty }
  }, null)
}

// combat.tex "Afflictions": "Sensory: Strike, Defend, Accuracy, Reflex,
// Detection, Balance, Climb, Exploration ... and Prestidigitation" —
// the sensory penalty a test made with the skill takes, as a term. Nothing
// for a skill outside the list.
export function getSensoryTerms(state: CombatState, actorId: string, skill: keyof Skills, toward: Toward, use: 'active' | 'reactive'): Term[] {
  if (!(SkillPenaltyTable.sensory as readonly string[]).includes(skill)) return []
  const best = getSensoryPenalty(state, actorId, toward, use)
  return [{ label: best ? `sensory (${best.sense})` : 'sensory', value: -(best?.penalty ?? 0) }]
}

// The sensory penalties of a test whose DL is written as skills of the actor
// (spells.tex: "DL: Accuracy"): one for each that is in the list.
export function getSensoryTermsOfDL(state: CombatState, actorId: string, dl: string, toward: Toward, use: 'active' | 'reactive'): Term[] {
  return dl.split('+').flatMap((label) => getSensoryTerms(state, actorId, label.trim().toLowerCase() as keyof Skills, toward, use))
}

// The sensory penalty a test made with the skill takes where the actor
// stands: the ground underfoot or the face in hand (combat.tex "Balance",
// "Climbing"). Nothing off the board.
export function getSensoryTermsHere(state: CombatState, actorId: string, skill: keyof Skills): Term[] {
  const here = getPlacedFootprint(state, actorId)
  return here ? getSensoryTerms(state, actorId, skill, here, 'active') : []
}

export type SenseReach = { sense: keyof Senses; active: boolean; reactive: boolean; impairment: Exclude<Impairment, 'total'>; terms: Term[]; detection: number }

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
