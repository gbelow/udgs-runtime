import type { AfflictionKey, CampaignCharacter, Character, Sense, Senses, Skills } from '../../types'
import { perState } from '../../perState'
import type { Action, Board, SceneState, Coord, Direction } from '../types'
import { BAD_VISIBILITY_PENALTY, FALL, FOG_VISION_RADIUS, SkillPenaltyTable } from '../../tables'
import { getDetectionTerms } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getSenseBonus } from '../../character/lenses/senses'
import { getSenses, getSensesInTurn } from '../../character/rules/senses'
import { getAfflictedSense } from '../../character/rules/afflictions'
import { getCamouflage } from '../../item/rules/items'
import { getSituationalAfflictions } from './situational'
import { add, coordKey, DIRECTIONS, directionTo, disk, parseCoordKey, ROTATIONS, sameCell, setDistance } from './board/geometry'
import { getDistanceBetween, getEyesToward, getPlacedFootprint, getTerrainAt, hasLineOfSight, isFloorBetween, LEVEL_EYES, seesAcross, type Eyes } from './board/board'
import { getCellHazard, getHazardAt } from './board/hazard'
import { crossesThinWall, isFootprintOpen, readGround } from './board/ground'
import { getPartners } from './partners'
import { getMoveOrigin } from './board/waypoint'
import { getDarkGround, getLightAt, isUnlit, seesInDimLight } from './board/light'
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
function getLookedAt(state: SceneState, action: Action, board: Board): Coord | null {
  if (action.kind === 'throw') return action.to
  const target = action.reactionTo ? getAction(state, action.reactionTo)?.actorId : TARGETED_KINDS.includes(action.kind) ? action.targetId : null
  return (target && board.placements[target]?.cell) || null
}

// The way a landed action leaves its actor facing: along the last step of a
// move, otherwise towards what they looked at. Null where there is no
// direction (no step, nothing looked at, the same cell).
export function getActionHeading(state: SceneState, action: Action, board: Board): Direction | null {
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

// What the character senses with, of each sense: their senses in the fight as
// it stands (in their own turn, what a mutation adds then), whether they can
// use it ("Afflictions": "Blind: ... Cannot use vision"), and the terms every
// test of it takes whatever it is aimed at: the detection skill, the sense's
// bonus, its own sensory penalty and what afflictions add to it.
type Sensing = { senses: Senses; usable: Record<keyof Senses, boolean>; terms: Record<keyof Senses, Term[]> }

// It is the character's alone, with whether it is their turn and the
// afflictions the fight puts on them: kept by the character, so that a fight
// a press made without changing any of those reads it again.
const sensings = new WeakMap<Character, Map<string, Sensing>>()
const sensingsOf = perState((_: SceneState) => new Map<string, Sensing>())

function getSensing(state: SceneState, c: Character): Sensing {
  const here = sensingsOf(state)
  const own = state.characters[c.id] === c
  const known = own ? here.get(c.id) : undefined
  if (known) return known
  const inTurn = state.inTurnCharacter === c.id
  const situational = getSituationalAfflictions(state, c.id)
  const key = `${inTurn}|${situational.join(',')}`
  const byKey = sensings.get(c) ?? new Map<string, Sensing>()
  sensings.set(c, byKey)
  const sensing = byKey.get(key) ?? makeSensing(c, inTurn, situational)
  byKey.set(key, sensing)
  if (own) here.set(c.id, sensing)
  return sensing
}

function makeSensing(c: Character, inTurn: boolean, situational: readonly AfflictionKey[]): Sensing {
  const senses = inTurn ? getSensesInTurn(c) : getSenses(c)
  const kinds = Object.keys(IMPAIRMENTS) as (keyof Senses)[]
  const detection = getDetectionTerms(c)
  const afflicted = Object.fromEntries(kinds.map((sense) => [sense, getAfflictedSense(c, sense, situational)])) as Record<keyof Senses, { lost: boolean; penalty: number }>
  return {
    senses,
    usable: Object.fromEntries(kinds.map((sense) => [sense, senses[sense].hasSense && !afflicted[sense].lost])) as Record<keyof Senses, boolean>,
    terms: Object.fromEntries(kinds.map((sense) => [sense, [
      ...detection,
      { label: sense, value: getSenseBonus(c, sense) },
      { label: `${sense} penalty`, value: -senses[sense].penalty },
      { label: 'afflictions', value: -afflicted[sense].penalty },
    ]])) as Record<keyof Senses, Term[]>,
  }
}

function sensesOf(state: SceneState, c: Character): Senses {
  return getSensing(state, c).senses
}

export type Impairment = 'none' | 'partial' | 'total'

type Impair = (state: SceneState, observerId: string, targetId: string, sense: Sense) => Impairment

// A sense that reaches as far as its range: null for no limit, 0 for what it
// touches, a grapple partner. What is within it is taken in whole, or partly
// for a sense that is `partial`.
const byRange: Impair = (state, o, t, { range, partial }) => {
  const within = partial ? 'partial' : 'none'
  if (range === null) return within
  if (range === 0) return getPartners(state, o).includes(t) ? within : 'total'
  const distance = getDistanceBetween(state, o, t)
  return distance === null || distance <= range ? within : 'total'
}

// A floor of a cell: the cell and the height of the floor there.
const floorKey = (cell: Coord, floor: number) => `${coordKey(cell)}@${floor}`

// How a perception spreads from the observer: around walls on a floor, as a
// walk would go, and up or down within a cell wherever it may rise, the
// metres climbed counted.
type Spread = 'gas' | 'sound'

// abilities.tex "Synesthesia": "The volume of perception is filled as if it
// were gas. Solid impermeable objects block the radius of synesthesia": it
// rises within a cell wherever no solid floor lies between (a stairwell, a
// lattice). A sound (combat.tex "Hearing") carries around walls and never
// through them, but a floor does not stop it: it rises within a cell into
// any height of it that is not a wall.
const RISES: Record<Spread, (board: Board, ground: NonNullable<ReturnType<typeof readGround>>, cell: Coord, from: number, to: number) => boolean> = {
  gas: (board, _, cell, from, to) => !isFloorBetween(board, cell, from, to),
  sound: (_, ground, cell, _from, to) => isFootprintOpen([cell], ground.at(to)),
}

// The floors a perception spreading as `spread` fills within `range` metres
// of the observer. It spreads at the height of the ground and of every
// storey, and fills a floor it passes less than a cliff over. Null off the
// board. Worked out once per fight state, observer, spread and range.
const filled = new WeakMap<SceneState, Map<string, Set<string> | null>>()
function getFilledFloors(state: SceneState, observerId: string, range: number, spread: Spread): Set<string> | null {
  const known = filled.get(state) ?? new Map<string, Set<string> | null>()
  filled.set(state, known)
  const key = `${observerId}:${range}:${spread}`
  if (known.has(key)) return known.get(key)!
  const board = state.board
  const from = getPlacedFootprint(state, observerId)
  const ground = readGround(state, observerId)
  if (!board || !from || !ground) {
    known.set(key, null)
    return null
  }
  const feet = board.placements[observerId]?.elevation ?? 0
  const heights = [...new Set([feet, 0, ...board.levels.map((l) => l.floor)])].sort((a, b) => a - b)
  const out = new Set<string>()
  const best = new Map<string, number>()
  let queue: { cell: Coord; height: number; cost: number }[] = []
  const push = (cell: Coord, height: number, cost: number) => {
    const node = `${coordKey(cell)}|${height}`
    if (cost > range || (best.get(node) ?? Infinity) <= cost) return
    best.set(node, cost)
    queue.push({ cell, height, cost })
  }
  for (const cell of from) push(cell, feet, 0)
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost)
    const [{ cell, height, cost }, ...rest] = queue
    queue = rest
    if (best.get(`${coordKey(cell)}|${height}`)! < cost) continue
    const under = getTerrainAt(board, cell, height).floor
    if (Math.abs(height - under) < FALL.minHeight) out.add(floorKey(cell, under))
    const floor = ground.at(height)
    for (const d of ROTATIONS) {
      const next = add(cell, DIRECTIONS[d])
      if (isFootprintOpen([next], floor) && !crossesThinWall([next], floor, cell, next)) push(next, height, cost + 1)
    }
    const i = heights.indexOf(height)
    for (const h of [heights[i - 1], heights[i + 1]]) {
      if (h !== undefined && RISES[spread](board, ground, cell, height, h)) push(cell, h, cost + Math.abs(h - height))
    }
  }
  known.set(key, out)
  return out
}

// Whether a perception spreading as `spread` fills a floor any of `at`
// stands on, at the height of feet `feet`; everywhere for one with no range,
// and off the board.
function fills(state: SceneState, observerId: string, at: readonly Coord[], feet: number, range: number | null, spread: Spread): boolean {
  if (range === null) return true
  const floors = getFilledFloors(state, observerId, range, spread)
  const board = state.board
  return !floors || !board || at.some((cell) => floors.has(floorKey(cell, getTerrainAt(board, cell, feet).floor)))
}

const byFill = (spread: Spread): Impair => (state, o, t, { range, partial }) => {
  const at = getPlacedFootprint(state, t)
  return !at || fills(state, o, at, state.board?.placements[t]?.elevation ?? 0, range, spread) ? (partial ? 'partial' : 'none') : 'total'
}

// combat.tex "Vision": how much of what stands on `at` an eye on `from`
// takes in, the ground between aside. "Darkness and light": "Anyone in the
// light radius is visible and anyone out is not. Dim light means partial
// impairment", unless the eye sees clearly in it; "Visibility": bad
// visibility is partial, none is nothing to target; "Fog and smoke": whoever
// stands in it sees no further than its radius, and others inside within it
// are in bad visibility.
// `feet` and `own` are the heights the one looked at and the eye stand at.
function seeInto(state: SceneState, from: Coord[], at: Coord[], dimSighted: () => boolean, feet?: number, own?: number): Impairment {
  const light = getLightAt(state, at, feet)
  if (light === 'dark') return 'total'
  const near = setDistance(from, at) <= FOG_VISION_RADIUS
  const inFog = getHazardAt(state, from, own).visibility === 'zero'
  const there = getHazardAt(state, at, feet).visibility
  if (there === 'zero') return inFog && near ? 'partial' : 'total'
  if (inFog && !near) return 'total'
  return there === 'bad' || (light === 'dim' && !dimSighted()) ? 'partial' : 'none'
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
    const seen = from && at ? seeInto(state, from, at, () => !!observer && seesInDimLight(observer), state.board?.placements[t]?.elevation, state.board?.placements[o]?.elevation) : 'none'
    return seen === 'none' && isCamouflaged(state, t) ? 'partial' : seen
  },
  // combat.tex "Hearing": "triggered by a sound event", as far as its range
  // spreads; nothing on the board muffles one yet
  hearing: byFill('sound'),
  // combat.tex "Smell": "Range of smell is 0, by default"
  smell: byRange,
  // combat.tex "Touch": "an active and reactive sense with 0m range"
  touch: byRange,
  synesthesia: byFill('gas'),
}

// combat.tex "Camouflage": "an item necessary to turn an area into a stealth
// area with bad visibility for a camouflaged character" — whether the
// character carries one. Matching it to the ground is the table's to judge.
function isCamouflaged(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && camouflageOf(c) !== null
}

// A character's camouflage is what they carry: kept by the character.
const camouflages = new WeakMap<Character, number | null>()
function camouflageOf(c: Character): number | null {
  if (!camouflages.has(c)) camouflages.set(c, getCamouflage(c))
  return camouflages.get(c)!
}

// combat.tex "Afflictions": "Blind: ... Cannot use vision", "Deaf: ... Cannot
// use hearing".
function canUse(state: SceneState, c: Character, sense: keyof Senses): boolean {
  return getSensing(state, c).usable[sense]
}

// Ground that totally impairs a sense of whoever looks into it: fog and smoke,
// dark ground no light reaches. Walls are not such ground.
function isBlindingGround(state: SceneState, cell: Coord): boolean {
  return isUnlit(state, cell) || getCellHazard(state, cell).visibility === 'zero'
}

type TotalInto = (state: SceneState, observerId: string, from: Coord[], at: Coord[], range: number | null) => boolean

const isBeyond: TotalInto = (_, _o, from, at, range) => range !== null && setDistance(from, at) > range

// Whether the sense, from where the observer stands, takes in nothing of
// whoever stood on `at` — `IMPAIRMENTS` of a place rather than a target,
// line of sight left out.
const TOTAL_INTO: Record<keyof Senses, TotalInto> = {
  vision: (state, _o, from, at) => seeInto(state, from, at, () => false) === 'total',
  hearing: (state, o, _from, at, range) => !fills(state, o, at, state.board?.placements[o]?.elevation ?? 0, range, 'sound'),
  smell: isBeyond,
  touch: isBeyond,
  synesthesia: (state, o, _from, at, range) => !fills(state, o, at, state.board?.placements[o]?.elevation ?? 0, range, 'gas'),
}

// combat.tex "Morale", "Sensory limitation": whether there is ground within
// `radius` metres of the character that every active sense they can use is
// totally impaired into. Only painted ground can be such, or any ground on a
// dark board; off the board, none is.
export function isNearBlindGround(state: SceneState, id: string, radius: number): boolean {
  const c = state.characters[id]
  const from = getPlacedFootprint(state, id)
  const terrain = state.board?.terrain
  if (!c || !from || !terrain) return false
  const near = state.board?.light === 'dark'
    ? from.flatMap((at) => disk(at, radius)).filter((cell) => setDistance(from, [cell]) <= radius && isBlindingGround(state, cell))
    : getBlindingGround(state).filter((cell) => setDistance(from, [cell]) <= radius)
  if (near.length === 0) return false
  const own = sensesOf(state, c)
  const senses = (Object.keys(TOTAL_INTO) as (keyof Senses)[]).filter((s) => own[s].active && canUse(state, c, s))
  return near.some((cell) => senses.every((s) => TOTAL_INTO[s](state, id, from, [cell], own[s].range)))
}

// The painted cells that could blind, kept by the terrain: those painted with
// bad visibility or carrying a layer, which may be smoke.
const hazyKept = new WeakMap<Board['terrain'], Coord[]>()
function getHazyGround(terrain: Board['terrain']): Coord[] {
  const known = hazyKept.get(terrain)
  if (known) return known
  const cells = Object.entries(terrain).flatMap(([key, t]) => (t.visibility !== 'good' || t.layers.length > 0 ? parseCoordKey(key) ?? [] : []))
  hazyKept.set(terrain, cells)
  return cells
}

// The painted cells that blind whoever looks into them, worked out once per
// fight for everyone it asks about: of those whose ground is dark or hazy,
// as no other can be.
const getBlindingGround = perState((state: SceneState): Coord[] => {
  if (!state.board) return []
  const candidates = new Map([...getDarkGround(state), ...getHazyGround(state.board.terrain)].map((cell) => [coordKey(cell), cell]))
  const found = [...candidates.values()].filter((cell) => isBlindingGround(state, cell))
  return found
})

// What an observer's sense is aimed at: a character, or cells of the ground.
export type Toward = string | readonly Coord[]

// combat.tex "Sensory Penalties": "Apply when acting under bad sensory
// conditions ... The penalties add up": the sense's own ("Senses":
// "Sensory penalty -3, by default"), what afflictions add to it
// ("Offuscated: -3 to sensory penalties when using vision") and, for vision
// partly impaired, the bad visibility it is impaired by ("Visibility": "a
// sensory penalty when targeting anything there").
function getSensoryTermsOf(state: SceneState, observer: CampaignCharacter, toward: Toward, sense: keyof Senses, impairment: Impairment): Term[] {
  return [...getSensing(state, observer).terms[sense].slice(-2), visibilityOf(state, observer, toward, sense, impairment)]
}

function visibilityOf(state: SceneState, observer: CampaignCharacter, toward: Toward, sense: keyof Senses, impairment: Impairment): Term {
  return { label: 'visibility', value: sense === 'vision' && impairment === 'partial' ? getVisibilityTerm(state, observer, toward) : 0 }
}

// combat.tex "Detection": "A character adds the value of their best available
// sense to awareness in detection tests. Any sensory penalties to a sense are
// added too": the skill, the sense's own bonus and its sensory penalty.
function getDetectionTermsThrough(state: SceneState, observer: CampaignCharacter, targetId: string, sense: keyof Senses, impairment: Impairment): Term[] {
  return [...getSensing(state, observer).terms[sense], visibilityOf(state, observer, targetId, sense, impairment)]
}

// The bad visibility a partly seen target is in: the ground's or the dim
// light's, or the degree of their camouflage, whichever is the worse for the
// observer.
function getVisibilityTerm(state: SceneState, observer: CampaignCharacter, toward: Toward): number {
  const target = typeof toward === 'string' ? state.characters[toward] : undefined
  const at = typeof toward === 'string' ? getPlacedFootprint(state, toward) ?? [] : [...toward]
  const camouflage = target ? camouflageOf(target) : null
  const feet = typeof toward === 'string' ? state.board?.placements[toward]?.elevation : undefined
  const ground = getHazardAt(state, at, feet).visibility
  const dim = getLightAt(state, at, feet) === 'dim' && !seesInDimLight(observer)
  const sources = [...(ground === 'bad' || ground === 'zero' || dim ? [BAD_VISIBILITY_PENALTY] : []), ...(camouflage === null ? [] : [-camouflage])]
  return sources.length === 0 ? 0 : Math.min(...sources)
}

// How much of cells of the ground a sense of the observer takes in from where
// they stand: `IMPAIRMENTS` of a place, line of sight kept along `eyes`.
function getImpairmentInto(state: SceneState, observer: CampaignCharacter, from: Coord[], at: Coord[], sense: keyof Senses, eyes: Eyes = LEVEL_EYES, floor?: number): Impairment {
  if (sense !== 'vision') {
    const { range, partial } = sensesOf(state, observer)[sense]
    return TOTAL_INTO[sense](state, observer.id, from, at, range) ? 'total' : partial ? 'partial' : 'none'
  }
  if (state.board && !seesAcross(state.board, from, at, eyes)) return 'total'
  return seeInto(state, from, at, () => seesInDimLight(observer), floor, state.board?.placements[observer.id]?.elevation)
}

// Whether an active sense of the observer takes in anything of a cell of the
// ground from where they stand, what the board shows of it to their eyes: of
// someone as tall as they are standing on the cell's floor `floor` high, by
// default the one their feet would reach there. Their own cells are always
// taken in; off the board, every cell is. Which senses the observer can use is
// settled once, for all the cells asked of.
export function getCellSenser(state: SceneState, observerId: string): (cell: Coord, floor?: number) => boolean {
  const c = state.characters[observerId]
  const from = getPlacedFootprint(state, observerId)
  const board = state.board
  if (!c || !from || !board) return () => true
  const feet = board.placements[observerId]?.elevation ?? 0
  const own = sensesOf(state, c)
  const senses = (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).filter((sense) => own[sense].active && canUse(state, c, sense))
  return (cell, floor = getTerrainAt(board, cell, feet).floor) => from.some((own) => sameCell(own, cell))
    || senses.some((sense) => getImpairmentInto(state, c, from, [cell], sense, getEyesToward(state, observerId, floor), floor) !== 'total')
}

function getImpairment(state: SceneState, observer: CampaignCharacter, toward: Toward, sense: keyof Senses): Impairment {
  if (typeof toward === 'string') return IMPAIRMENTS[sense](state, observer.id, toward, sensesOf(state, observer)[sense])
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
export function getSensoryPenalty(state: SceneState, actorId: string, toward: Toward, use: 'active' | 'reactive'): SensoryPenalty | null {
  const c = state.characters[actorId]
  if (!c || toward === actorId) return null
  return (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).reduce<SensoryPenalty | null>((best, sense) => {
    if (!sensesOf(state, c)[sense][use] || !canUse(state, c, sense)) return best
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
export function getSensoryTerms(state: SceneState, actorId: string, skill: keyof Skills, toward: Toward, use: 'active' | 'reactive'): Term[] {
  if (!(SkillPenaltyTable.sensory as readonly string[]).includes(skill)) return []
  const best = getSensoryPenalty(state, actorId, toward, use)
  return [{ label: best ? `sensory (${best.sense})` : 'sensory', value: -(best?.penalty ?? 0) }]
}

// The sensory penalties of a test whose DL is written as skills of the actor
// (spells.tex: "DL: Accuracy"): one for each that is in the list.
export function getSensoryTermsOfDL(state: SceneState, actorId: string, dl: string, toward: Toward, use: 'active' | 'reactive'): Term[] {
  return dl.split('+').flatMap((label) => getSensoryTerms(state, actorId, label.trim().toLowerCase() as keyof Skills, toward, use))
}

// The sensory penalty a test made with the skill takes where the actor
// stands: the ground underfoot or the face in hand (combat.tex "Balance",
// "Climbing"). Nothing off the board.
export function getSensoryTermsHere(state: SceneState, actorId: string, skill: keyof Skills): Term[] {
  const here = getPlacedFootprint(state, actorId)
  return here ? getSensoryTerms(state, actorId, skill, here, 'active') : []
}

export type SenseReach = { sense: keyof Senses; active: boolean; reactive: boolean; impairment: Exclude<Impairment, 'total'>; terms: Term[]; detection: number }

// Every sense of the observer that takes the target in at all, with how
// impaired it is and what it detects at. Empty for an observer or target not
// in the fight, and for oneself.
// Read once per fight and pair: whether one sees the other and whether they
// notice them both ask it.
export function getSenseReaches(state: SceneState, observerId: string, targetId: string): SenseReach[] {
  const known = reachesOf(state)
  const key = `${observerId}>${targetId}`
  const kept = known.get(key)
  if (kept) return kept
  const reaches = readSenseReaches(state, observerId, targetId)
  known.set(key, reaches)
  return reaches
}

const reachesOf = perState((_: SceneState) => new Map<string, SenseReach[]>())

function readSenseReaches(state: SceneState, observerId: string, targetId: string): SenseReach[] {
  const observer = state.characters[observerId]
  if (!observer || !state.characters[targetId] || observerId === targetId) return []
  const { senses, usable } = getSensing(state, observer)
  return (Object.keys(IMPAIRMENTS) as (keyof Senses)[]).flatMap((sense) => {
    if (!usable[sense]) return []
    const { active, reactive } = senses[sense]
    const impairment = IMPAIRMENTS[sense](state, observerId, targetId, senses[sense])
    if (impairment === 'total') return []
    const terms = getDetectionTermsThrough(state, observer, targetId, sense, impairment)
    return [{ sense, active, reactive, impairment, terms, detection: sumTerms(terms) }]
  })
}
