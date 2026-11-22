import type { CampaignCharacter, Coord, MovementKind, SurgeKind, Third } from '../types'
import type { SceneState } from '../scene/types'
import type { RollMode } from '../play/dice'
import { getMovementOptions } from '../scene/rules/move'
import { getKeptWalk } from './walks'
import { makeAction } from '../scene/factories'
import { coordKey, disk, distance, extentCells, parseCoordKey, sameCell } from '../scene/rules/board/geometry'
import { getDistancePenalty, getShotReach } from '../character/rules/gear'
import { getSTA } from '../character/rules/characteristics'
import { getMovementBlock } from '../character/rules/movement'
import { MOVEMENT_KINDS } from '../lists'
import { canSurge, getSurgeAP, getSurgeSTA } from '../character/rules/surge'
import { ROUND_AP } from '../tables'
import { getRememberedAge } from './memory'
import { getPair, harmOf, type PairAttack, type PairDefence } from './pairs'
import { getExpectedHarm } from './odds'
import { getSides, isDown } from './table'
import { getHeight } from '../character/rules/size'
import { getWeaponRows, isRowUsable } from '../scene/rules/weaponRow'
import { firesAcross, getBodyAt, getEyes, getMeleeGap, getReach, placeAt, withPlacements } from '../scene/rules/board/board'
import { isMeleeRange } from '../weaponProperties'

// The threat one character puts on another (the user's rulings, 2026-11-14,
// 2026-11-20), in two layers.
//
// The pair threat (`getPairThreat`) is only harm and cost, read once for a
// pair of sheets and kept while neither changes in what it reads: every
// attack of the attacker's on the target, each with its cost, its harm
// against every defence the target could answer with, and its worth against
// the one it is believed to answer with on a fresh round's guard, a shot's
// read from PAIR_GAP metres. Where anyone stands and what anyone has left are
// not in it, and it picks no attack: what reads it does.
//
// On top of it (`makeThreat`): the attack with the most worth for every AP it
// costs, the AP of the walk into its reach, how many times what is left
// pays for it, and the attacks worth most that what is left after those still
// pays for (`getFillers`). Potential threat is next round's:
// as many times as a fresh round (8 AP and the movement surge) pays for once
// the walk in is paid, none where the walk in and one attack do not fit in
// the round (the user's ruling: a foe further off is gone after by the
// walk's own pull, bot/boxes/threat.ts). Immediate threat is this round's: as
// many times as the attacker can still pay for with what it is believed to
// have left. A target that cannot be harmed even undefended, or not this
// round, is under no threat from it.
//
// What a seat knows of a character it does not play is its face: which third
// of a round's AP and of its STA it has left, taken at the end `end` says.
// Nothing here decides; it reads.

export type ThreatTuning = {
  // what spending costs a character, for any spender and anything spent on
  // (`getSpendPrice`): an AP at `AP` plus `danger` times the danger the
  // spender is left in, an STA at `STA` as `getSTAPrice` prices it
  AP: number
  STA: number
  danger: number
  // what an attack is worth more for every point of harm the defence takes
  // off (`getDefendedHarm`)
  forcing: number
  // the STA against which a pool is measured (`getSTAPrice`)
  STAScale: number
  // what a walk or an attack of the character's own is worth less for every
  // point of worth of the opportunity attacks it draws (bot/approach.ts)
  opportunity: number
  // the end of a face's third taken as what a character has left, or its middle
  end: 'least' | 'middle' | 'most'
  // how much of every foe's threat but the worst a character's danger adds
  // (`getDanger`): 1 every foe's whole (the user's ruling:
  // each foe pays for its strikes with AP of its own), 0 the worst foe's alone
  pile: number
  // how far a foe's threat on a character is shared among everyone of its
  // side the foe threatens (`shareOf`): its threat divided by their number to
  // the power `share`, 0 not shared at all
  share: number
  // what a foe standing where the seat remembers it is counted for, for every
  // round since it was noticed (bot/memory.ts): its threat and the harm it does
  // times `fade` to the power of the rounds (the user's ruling: it fades)
  fade: number
}

export const THREAT_TUNING: ThreatTuning = { AP: 3, STA: 3, danger: 0.1, forcing: 0.25, STAScale: 3, opportunity: 1, end: 'middle', pile: 1, share: 0, fade: 0.5 }

// How much of a foe counts where it stands in `state`: all of one the seat
// notices, `fade` to the power of the rounds since it was noticed for one it
// remembers there.
export function getPresence(state: SceneState, foe: string, tuning: ThreatTuning): number {
  const age = getRememberedAge(state, foe)
  return age === null ? 1 : tuning.fade ** age
}

// One attack of the attacker's on the target (`getPairThreat`): what it is
// worth against the answer the target is believed to choose
// (`getDefendedHarm`: the harm it takes, what it pays to defend, and more the
// more the defence takes off), the harm it takes then, its harm answered with
// none, what each defence leaves of it, and its worth for every AP it costs.
export type AttackThreat = {
  attack: PairAttack
  worth: number
  harm: number
  defence: PairDefence
  undefended: number
  answers: Answer[]
  perAP: number
}

// Every attack of the attacker's on the target, read as `AttackThreat`.
export type PairThreat = readonly AttackThreat[]

// The pair threat made where the attacker stands, with what it has: the AP of
// the walk into the attack's reach, and how many times the attack is made
// after it: this round, as many as the attacker's means pay for
// (`getImmediateStrikes`); next round, as many as a fresh round pays for
// (`getPotentialStrikes`).
// `fillers`: the attacks the AP and STA left after the strikes pay for besides (`getFillers`).
export type Threat = AttackThreat & { moveAP: number; strikes: number; fillers: AttackThreat[] }

// What a threat is worth: every strike, and every filler after them, at its
// worth; with the `guard` the target defends with, only those the guard
// answers, in that order, the rest landing at the harm undefended (the guard
// is spent across them).
export function threatValue(t: Threat | null, guard?: { AP: number; STA: number }): number {
  if (!t) return 0
  const hits: AttackThreat[] = [...Array.from({ length: t.strikes }, () => t), ...t.fillers]
  if (!guard) return hits.reduce((sum, h) => sum + h.worth, 0)
  let { AP, STA } = guard
  return hits.reduce((sum, h) => {
    const cost = h.defence.cost
    if (AP < cost.AP || STA < cost.STA) return sum + h.undefended
    AP -= cost.AP
    STA -= cost.STA
    return sum + h.worth
  }, 0)
}

// The least or the most a third of `most` could hold (character/lenses/face.ts
// `thirdOf`), or halfway between them, rounded.
export function fromThird(third: Third, most: number, end: ThreatTuning['end']): number {
  if (end === 'middle') return Math.round((fromThird(third, most, 'least') + fromThird(third, most, 'most')) / 2)
  if (end === 'most') return Math.floor((most * (third + 1)) / 3)
  return third === 0 ? 0 : Math.floor((most * third) / 3) + 1
}

export type Means = { AP: number; STA: number; surge: boolean }

// What a character has left this round as the seat takes it: its own sheet
// for one it plays, the face for anyone else.
export function getMeans(c: CampaignCharacter, plays: boolean, tuning: ThreatTuning): Means {
  const surge = c.usedSurge === null
  if (plays || !c.shown) return { AP: c.resources.AP, STA: c.resources.STA, surge }
  return { AP: fromThird(c.shown.AP, ROUND_AP, tuning.end), STA: fromThird(c.shown.STA, getSTA(c), tuning.end), surge }
}

// A fresh round's means: the round's AP and the movement surge; STA does not
// come back with the round.
const freshMeans = (now: Means): Means => ({ AP: ROUND_AP, STA: now.STA, surge: true })

// How far the character goes and for what, at its fastest movement open: the
// metres of a block and the AP and STA a block costs, and whether it runs or
// jumps, which a braced attack answers.
type Pace = { metres: number; AP: number; STA: number; running: boolean }

const paces = new WeakMap<SceneState, Map<string, Pace | null>>()

export function getPace(state: SceneState, id: string): Pace | null {
  const byId = paces.get(state) ?? new Map<string, Pace | null>()
  paces.set(state, byId)
  if (byId.has(id)) return byId.get(id) ?? null
  const c = state.characters[id]
  const open = c ? getMovementOptions(state, c).filter((o) => o.available && o.speed > 0 && o.block.AP > 0) : []
  const best = open.reduce<(typeof open)[number] | null>((b, o) => (!b || o.speed / o.block.AP > b.speed / b.block.AP ? o : b), null)
  const pace = best ? { metres: best.speed, AP: best.block.AP, STA: best.block.STA, running: best.kind === 'run' || best.kind === 'jump' } : null
  byId.set(id, pace)
  return pace
}

// What of a sheet its walking reads (`getPace`, `walkMap`): the movements
// open to it, each one's speed, block and price, and the STA it holds.
function walkingOf(state: SceneState, c: CampaignCharacter): string {
  return JSON.stringify([getMovementOptions(state, c), MOVEMENT_KINDS.map((kind) => getMovementBlock(c, kind)), c.resources.STA])
}

// The fight with `id`'s sheet replaced by `c`, where it stands as it stood
// (a change of gear): what is known of how everyone else walks is kept, since
// only `c` changed, and `c`'s own too where the change leaves its walking as
// it was (`walkingOf`); otherwise it is read anew.
export function withSheet(state: SceneState, id: string, c: CampaignCharacter): SceneState {
  const next: SceneState = { ...state, characters: { ...state.characters, [id]: c } }
  const was = state.characters[id]
  const walksAlike = !!was && walkingOf(state, was) === walkingOf(next, c)
  const keep = <T>(cache: WeakMap<SceneState, Map<string, T>>) => {
    const known = cache.get(state)
    if (known) cache.set(next, new Map([...known].filter(([key]) => walksAlike || key.split('|')[0] !== id)))
  }
  keep(paces)
  keep(stepMaps)
  keep(routeMaps)
  return next
}

export const cellOf = (state: SceneState, id: string): Coord | null => state.board?.placements[id]?.cell ?? null

// How many cells the character walks to each cell it can get to, counted as it
// moves (combat.tex "Movement"): around walls and bodies, on the ground it can
// stand on, as far as a fresh round carries it at its fastest pace. Walked at
// the walk (or the first other movement open), so the path is not bent by a
// run's turning; how fast it covers the cells is its pace's (`getPace`).
type StepMap = Map<string, number>

const MAP_ROUNDS = 1

const stepMaps = new WeakMap<SceneState, Map<string, StepMap | null>>()

export function getStepMap(state: SceneState, id: string): StepMap | null {
  const byId = stepMaps.get(state) ?? new Map<string, StepMap | null>()
  stepMaps.set(state, byId)
  if (byId.has(id)) return byId.get(id) ?? null
  const made = walkMap(state, id)
  byId.set(id, made)
  return made
}

function walkMap(state: SceneState, id: string): StepMap | null {
  const c = state.characters[id]
  const from = cellOf(state, id)
  const pace = getPace(state, id)
  if (!c || !from || !pace) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0 && o.block.AP > 0 && o.kind !== 'jump')
  const walk = open.find((o) => o.kind === 'walk') ?? open[0]
  if (!walk) return null
  const metres = MAP_ROUNDS * (ROUND_AP + getSurgeAP('movement')(c)) * (pace.metres / pace.AP)
  const AP = Math.ceil(metres / walk.speed) * walk.block.AP
  const rich: SceneState = { ...state, characters: { ...state.characters, [id]: { ...c, resources: { ...c.resources, AP, STA: Math.max(c.resources.STA, Math.ceil(metres / walk.speed) * walk.block.STA) } } } }
  const map: StepMap = new Map([[coordKey(from), 0]])
  for (const r of getKeptWalk(rich, makeAction('move', { id: 'step-map', actorId: id, movement: walk.kind }))) {
    const key = coordKey(r.cell)
    if (!map.has(key) || r.steps < map.get(key)!) map.set(key, r.steps)
  }
  return map
}

// The most cells the map walks to anywhere.
const edges = new WeakMap<StepMap, number>()

function mapEdge(map: StepMap): number {
  let edge = edges.get(map)
  if (edge === undefined) {
    edge = 0
    for (const steps of map.values()) if (steps > edge) edge = steps
    edges.set(map, edge)
  }
  return edge
}

// The fewest cells `mover` walks, from where it stands, to stand within
// `reach` of `at` at a cell `clear` keeps (a shot's: one with a line of fire
// to `at`); null when it cannot get there in the round the map covers.
type Clear = (cell: Coord) => boolean
const ANYWHERE: Clear = () => true

function stepsWithin(state: SceneState, mover: string, at: Coord, reach: number, clear: Clear = ANYWHERE): number | null {
  const from = cellOf(state, mover)
  if (from && distance(from, at) <= reach && clear(from)) return 0
  const map = getStepMap(state, mover)
  if (!map) return null
  let fewest: number | null = null
  const r = Math.floor(reach)
  if (3 * r * (r + 1) + 1 < map.size) {
    for (const cell of disk(at, r)) {
      const steps = map.get(coordKey(cell))
      if (steps !== undefined && (fewest === null || steps < fewest) && clear(cell)) fewest = steps
    }
    return fewest
  }
  for (const { cell, steps } of mapCells(map)) {
    if (distance(cell, at) <= reach && (fewest === null || steps < fewest) && clear(cell)) fewest = steps
  }
  return fewest
}

// The map's cells, read once.
const cellLists = new WeakMap<StepMap, { cell: Coord; steps: number }[]>()

function mapCells(map: StepMap): { cell: Coord; steps: number }[] {
  let list = cellLists.get(map)
  if (!list) {
    list = [...map].flatMap(([key, steps]) => {
      const cell = parseCoordKey(key)
      return cell ? [{ cell, steps }] : []
    })
    cellLists.set(map, list)
  }
  return list
}

// The cells walked for `a`, standing at `from`, to come within `reach` of `d`
// standing at `at`. Walked from where `a` stands; for `a` supposed elsewhere,
// walked back from where `d` stands, the same way taken the other way round.
// For a shot (`clear`), within reach means where there is a line of fire too;
// walked back from `d`, a cell in reach with none is a step short of one.
function closingSteps(state: SceneState, a: string, from: Coord | null, d: string, at: Coord | null, reach: number, clear: Clear = ANYWHERE): number | null {
  if (!from || !at || !state.board) return 0
  if (distance(from, at) <= reach && clear(from)) return 0
  const straight = Math.max(distance(from, at) <= reach ? 1 : 0, distance(from, at) - reach)
  const here = cellOf(state, a)
  const there = cellOf(state, d)
  const map = here && sameCell(here, from) ? getStepMap(state, a) : there && sameCell(there, at) ? getStepMap(state, d) : null
  if (!map) return straight
  const walked = here && sameCell(here, from) ? stepsWithin(state, a, at, reach, clear) : distance(from, at) <= reach ? 1 : stepsWithin(state, d, from, reach)
  // past what the map covers, as far as the straight line says, but never nearer than the map's edge
  return walked ?? Math.max(straight, mapEdge(map) + 1)
}

// The AP of the blocks it takes to walk `steps` cells; null when it cannot be walked.
function closingAP(pace: Pace | null, steps: number | null): number | null {
  if (steps === null) return null
  if (steps === 0) return 0
  return pace ? Math.ceil(steps / pace.metres) * pace.AP : null
}

// The attack's skill from `gap` metres: a shot's distance penalty taken off
// at the distance it is fired from, `gap` or, closed to its reach, the reach.
export function getSkillAt(attack: PairAttack, gap: number): number {
  return attack.skill - (attack.distanceRate !== null ? getDistancePenalty(attack.distanceRate, Math.min(gap, attack.reach)) : 0)
}

// Which way of throwing the attack's test counts: the way it is thrown now,
// or the one of the ways the attacker may throw it that does the most harm.
export type ModeOf = 'now' | 'best'

// The harm of the attack against a defence.
export function getHarmAgainst(attack: PairAttack, defence: PairDefence, gap: number, mode: ModeOf = 'now'): number {
  const at = (m: RollMode) => getExpectedHarm(getSkillAt(attack, gap), defence.DL, attack.grazes, m, harmOf(attack, defence))
  return mode === 'now' ? at(attack.mode) : Math.max(...attack.modes.map(at))
}

// What each defence the target could answer with leaves of the attack's harm,
// and what it is worth: the harm it takes off answering with none (the SD).
// The greater the difference, the more the defence is worth.
export type Answer = { defence: PairDefence; harm: number; value: number; affordable: boolean }

export function getAnswers(attack: PairAttack, gap: number, budget: { AP: number; STA: number }, mode: ModeOf = 'now'): { undefended: number; answers: Answer[] } {
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap, mode) : 0
  const answers = attack.defences.map((defence) => {
    const harm = defence === none ? undefended : getHarmAgainst(attack, defence, gap, mode)
    return { defence, harm, value: undefended - harm, affordable: defence.cost.AP <= budget.AP && defence.cost.STA <= budget.STA }
  })
  return { undefended, answers }
}

// The price of resources, the one each is priced at whoever spends or gains
// them and on whatever, weighed by the tuning's `AP`, `danger` and `STA`.

// What `AP` AP cost one left in `danger` by spending them (the user's ruling:
// every AP spent costs something, more the more threatened the spender is
// left): each at `AP` plus `danger` times the danger.
export function getAPPrice(AP: number, danger: number, tuning: ThreatTuning): number {
  return Math.max(0, AP) * (tuning.AP + tuning.danger * danger)
}

// What `spent` STA cost one holding `held`, at `STA` for each: dearer the
// less would be left, so that a small pool, or one run down, is spent
// sparingly; and every STA spent bleeding adds its IL (combat.tex "Bleed"),
// harm to the spender. What STA gained is worth is the same price, read for
// the pool it ends in.
export function getSTAPrice(spent: number, held: number, bleed: number, tuning: ThreatTuning): number {
  if (spent <= 0) return 0
  return spent * (tuning.STA * tuning.STAScale / Math.max(1, held - spent) + 2 * bleed)
}

// What spending `spent` costs one holding `held` STA, bleeding `bleed`, left
// in `danger` by it: its AP (`getAPPrice`) and its STA (`getSTAPrice`).
export function getSpendPrice(spent: { AP: number; STA: number }, held: number, bleed: number, danger: number, tuning: ThreatTuning): number {
  return getAPPrice(spent.AP, danger, tuning) + getSTAPrice(spent.STA, held, bleed, tuning)
}

// What spending `spent` on a defence costs the one defending, read where it
// is known (`getTargetSpend`).
export type SpendCost = (spent: { AP: number; STA: number }) => number

// The attack against the answer the target is believed to choose: of those
// it can pay for (none among them), the one that leaves it the least harm and
// spending together. What the attack is worth is what the answer costs the
// target, the harm it takes and what it spends, and more by `forcing` for
// every point of harm the defence takes off: an attack the target cannot
// leave unanswered drains it whichever way it answers (the user's ruling).
// What it spends costs what `spent` says (`getTargetSpend`: what the AP and
// STA would have done otherwise this round); with none given, as inside the
// threats themselves, which that is read from, its price (`getSpendPrice`)
// with no danger read.
export function getDefendedHarm(attack: PairAttack, gap: number, budget: { AP: number; STA: number }, mode: ModeOf = 'now', bleed = 0, tuning: ThreatTuning, spent?: SpendCost): { worth: number; harm: number; defence: PairDefence; undefended: number; answers: Answer[] } | null {
  const { undefended, answers } = getAnswers(attack, gap, budget, mode)
  const cost = (a: Answer) => a.harm + (spent ? spent(a.defence.cost) : getSpendPrice(a.defence.cost, budget.STA, bleed, 0, tuning))
  const best = answers.filter((a) => a.affordable).reduce<Answer | null>((b, a) => (!b || cost(a) < cost(b) ? a : b), null)
  return best ? { worth: cost(best) + tuning.forcing * best.value, harm: best.harm, defence: best.defence, undefended, answers } : null
}

type Party = { state: SceneState; id: string; at: Coord | null }

// How many times the attack is made after the walk in, out of `AP` and `STA`,
// and what is left of them after it.
type Strikes = { strikes: number; AP: number; STA: number }

function strikesOf(attack: PairAttack, AP: number, STA: number): Strikes {
  const byAP = attack.cost.AP > 0 ? Math.floor(AP / attack.cost.AP) : AP >= 0 ? 1 : 0
  const bySTA = attack.cost.STA > 0 ? Math.floor(STA / attack.cost.STA) : byAP
  const strikes = Math.max(0, Math.min(byAP, bySTA))
  return { strikes, AP: AP - strikes * attack.cost.AP, STA: STA - strikes * attack.cost.STA }
}

// How many times the attack, after the walk in, can be made this round from
// `means` (the user's ruling: a threat counts the attacker's AP, ours as a
// foe's): with no surge, the movement surge paying for the walk (what is left
// of it given up for the attack), or the combat surge, which pays for both
// (combat.tex "Action surge"), where the attacker may make it (`combat`, null
// where it may not: an afraid one may not), whichever pays for the most, and
// of those the one leaving the most AP; neither alongside the focus surge a
// row needs. Null when not even once.
function getImmediateStrikes(attack: PairAttack, moveAP: number, means: Means, surge: { AP: number; STA: number }, combat: { AP: number; STA: number } | null, focused: boolean): Strikes | null {
  if (attack.needsFocus && !focused && !means.surge) return null
  const canSurge = means.surge && !(attack.needsFocus && !focused)
  const ways = [strikesOf(attack, means.AP - moveAP, means.STA)]
  if (canSurge) ways.push(strikesOf(attack, means.AP - Math.max(0, moveAP - surge.AP), means.STA - surge.STA))
  if (canSurge && combat) ways.push(strikesOf(attack, means.AP + combat.AP - moveAP, means.STA - combat.STA))
  const best = ways.reduce((b, w) => (w.strikes > b.strikes || (w.strikes === b.strikes && w.AP > b.AP) ? w : b))
  return best.strikes >= 1 ? best : null
}

// How many times the attack is made in a fresh round once the walk in is
// paid for (the user's ruling: walking in spends AP that would be attacks):
// the movement surge (not alongside the focus surge a row needs) paying for
// the walk first, the rest out of the round's own AP. Null when the walk in
// and one attack do not fit in the round.
function getPotentialStrikes(attack: PairAttack, moveAP: number, means: Means, surge: { AP: number; STA: number }): Strikes | null {
  const surged = !attack.needsFocus && moveAP > 0
  const made = strikesOf(attack, means.AP - (surged ? Math.max(0, moveAP - surge.AP) : moveAP), means.STA - (surged ? surge.STA : 0))
  return made.strikes >= 1 ? made : null
}

// What the AP and STA left, once the strongest attack per AP is made as often
// as it can be, pay for besides (the user's ruling, 2026-11-22: a round is
// filled with attacks): the attack worth most of those that fit what is left,
// again and again while one fits. Only attacks the attacker declares on its
// turn that do the target some harm undefended, of the same kind and reaching
// as far as the strongest one, so that they are made from where it is.
function getFillers(pair: PairThreat, core: AttackThreat, AP: number, STA: number): AttackThreat[] {
  const fits = pair.filter((t) => t.attack.opens.action && t.undefended > 0 && t.attack.kind === core.attack.kind && t.attack.reach >= core.attack.reach && (t.attack.cost.AP > 0 || t.attack.cost.STA > 0))
  const made: AttackThreat[] = []
  for (;;) {
    const next = fits.reduce<AttackThreat | null>((b, t) => (t.attack.cost.AP <= AP && t.attack.cost.STA <= STA && (!b || t.worth > b.worth) ? t : b), null)
    if (!next) return made
    made.push(next)
    AP -= next.attack.cost.AP
    STA -= next.attack.cost.STA
  }
}

// The combat surge the attacker may make this round, or null: the table's own
// gate (`canSurge`), which one who has made a surge, cannot pay its STA or is
// afraid fails. Counted in immediate threat only (the user's ruling).
function combatSurge(c: CampaignCharacter): { AP: number; STA: number } | null {
  return canSurge('combat')(c) ? { AP: getSurgeAP('combat')(c), STA: getSurgeSTA('combat')(c) } : null
}

// Where a shot from `a` at `d` standing at `d.at` has a line of fire.
function fireLine(a: Party, d: Party): Clear {
  const board = a.state.board
  const at = d.at
  if (!board || !at) return ANYWHERE
  const eyes = getEyes(a.state, a.id, d.id)
  return (cell) => firesAcross(board, [cell], [at], eyes)
}

// Where a strike from `a` with `reach` meets `d` standing at `d.at`: the
// cells from which the melee gap the table measures (`getMeleeGap`: the cells
// across along a line no wall stops, or the metres up or down between them)
// is within it, so that a ledge or a wall between them is not reached over.
function meleeLine(a: Party, d: Party, reach: number): Clear {
  return getStrikeCells(a.state, a.id, d.id, d.at, reach)
}

export function getStrikeCells(state: SceneState, a: string, d: string, at: Coord | null, reach: number): Clear {
  const board = state.board
  const ca = state.characters[a]
  const cd = state.characters[d]
  const pa = board?.placements[a]
  const pd = board?.placements[d]
  if (!board || !at || !ca || !cd || !pa || !pd) return ANYWHERE
  const target = getBodyAt(cd, sameCell(pd.cell, at) ? pd : placeAt(board, pd, at))
  return (cell) => getMeleeGap(board, getBodyAt(ca, sameCell(pa.cell, cell) ? pa : placeAt(board, pa, cell)), target) <= reach
}

// The metres a shot is read from in the pair threat (the user's ruling: one
// distance penalty level, inside the 10 to 30 metres most shots are fired
// from, which tells the kinds of shot apart).
const PAIR_GAP = 10

// The pair threat of `attacker` on `defender` (`PairThreat`): every attack of
// the pair table the target has an answer to it can pay for, the answer picked
// as the target picks one live (`getTargetSpend`), by the harm it leaves and
// what it spends (the user's ruling: one pick, the same numbers everywhere),
// its AP read at what an AP does for it against the attacker
// (`getPairAPValue`) and its STA at its worth (`getSTAWorth`). Kept by the pair
// table the two sheets read (`getPair`, which leaves out what each has left),
// and by the STA and bleed the defence is priced with.
const pairThreats = new WeakMap<PairAttack[], WeakMap<ThreatTuning, Map<string, PairThreat>>>()
const pricedThreats = new WeakMap<PairAttack[], WeakMap<ThreatTuning, Map<string, PairThreat>>>()

function keptPair(cache: typeof pairThreats, pair: PairAttack[], tuning: ThreatTuning, key: string, read: () => PairThreat): PairThreat {
  let byTuning = cache.get(pair)
  if (!byTuning) cache.set(pair, (byTuning = new WeakMap()))
  let byKey = byTuning.get(tuning)
  if (!byKey) byTuning.set(tuning, (byKey = new Map()))
  const known = byKey.get(key)
  if (known) return known
  const made = read()
  byKey.set(key, made)
  return made
}

function readPair(pair: PairAttack[], defender: CampaignCharacter, STA: number, tuning: ThreatTuning, spend?: SpendCost): PairThreat {
  return pair.flatMap((attack) => {
    const met = getDefendedHarm(attack, PAIR_GAP, { AP: ROUND_AP, STA }, 'now', defender.injuries.bleed, tuning, spend)
    return met ? [{ attack, worth: met.worth, harm: met.harm, defence: met.defence, undefended: met.undefended, answers: met.answers, perAP: met.worth / Math.max(1, attack.cost.AP) }] : []
  })
}

// What an AP does for `c` against `foe`, as the pair threat reads it: the most
// harm for every AP of its attacks on the foe (read with the defence the foe
// picks at its price, `getSpendPrice`, so that the reading does not go round).
function getPairAPValue(c: CampaignCharacter, foe: CampaignCharacter, tuning: ThreatTuning): number {
  const pair = getPair(c, foe)
  const STA = getSTA(foe)
  const priced = keptPair(pricedThreats, pair, tuning, `${STA}|${foe.injuries.bleed}`, () => readPair(pair, foe, STA, tuning))
  return priced.reduce((most, t) => (t.attack.opens.action && t.undefended > 0 ? Math.max(most, t.harm / Math.max(1, t.attack.cost.AP)) : most), 0)
}

// `surge` as in `getPair`: the defender's own this round by default, null
// for a fresh round, in which the surge made this one has lapsed.
export function getPairThreat(attacker: CampaignCharacter, defender: CampaignCharacter, STA: number, tuning: ThreatTuning, surge: SurgeKind | null = defender.usedSurge): PairThreat {
  const pair = getPair(attacker, defender, surge)
  return keptPair(pairThreats, pair, tuning, `${STA}|${defender.injuries.bleed}`, () => {
    const APvalue = getPairAPValue(defender, attacker, tuning)
    return readPair(pair, defender, STA, tuning, (spent) => spent.AP * APvalue + getSTAWorth(defender, spent.STA, STA, APvalue, tuning))
  })
}

// Of a pair threat, the attack the attacker can declare on its turn (not one
// only a reaction makes) that does the target some harm undefended, with the
// most worth for every AP; null when there is none.
export function getStrongestPerAP(pair: PairThreat): AttackThreat | null {
  return pair.reduce<AttackThreat | null>((best, t) => (t.attack.opens.action && t.undefended > 0 && (!best || t.perAP > best.perAP) ? t : best), null)
}

// The strongest attack per AP of the pair threat of `a` on `d`
// (`getStrongestPerAP`), the defence priced with `guardSTA`, made from where
// `a` stands at `a.at` on `d` standing at `d.at`: the walk into its reach,
// and the strikes `means` pays for after it.
function makeThreat(a: Party, d: Party, means: Means, guardSTA: number, when: 'now' | 'potential', tuning: ThreatTuning): Threat | null {
  const attacker = a.state.characters[a.id]
  const defender = d.state.characters[d.id]
  if (!attacker || !defender) return null
  const pair = getPairThreat(attacker, defender, guardSTA, tuning, when === 'potential' ? null : defender.usedSurge)
  const core = getStrongestPerAP(pair)
  if (!core) return null
  const { attack } = core
  const moveAP = closingAP(getPace(a.state, a.id), closingSteps(a.state, a.id, a.at, d.id, d.at, attack.reach, attack.kind === 'shoot' ? fireLine(a, d) : meleeLine(a, d, attack.reach)))
  if (moveAP === null) return null
  const surge = { AP: getSurgeAP('movement')(attacker), STA: getSurgeSTA('movement')(attacker) }
  const made = when === 'now' ? getImmediateStrikes(attack, moveAP, means, surge, combatSurge(attacker), attacker.usedSurge === 'focus') : getPotentialStrikes(attack, moveAP, means, surge)
  return made === null ? null : { ...core, moveAP, strikes: made.strikes, fillers: getFillers(pair, core, made.AP, made.STA) }
}

// The attack the character can make with what it holds as it holds it
// (`isRowUsable`: a bow in one hand shoots nothing) that reaches furthest:
// its reach in metres, a melee row's (`getReach`) or a shot's
// (`getShotReach`), and whether it is a shot. Null with nothing to attack with.
type LongestAttack = { reach: number; shoots: boolean } | null

const longest = new WeakMap<CampaignCharacter, LongestAttack>()

function getLongestAttack(c: CampaignCharacter): LongestAttack {
  if (longest.has(c)) return longest.get(c) ?? null
  const made = getWeaponRows(c).filter((row) => isRowUsable(c, row)).reduce<LongestAttack>((best, row) => {
    const range = row.atk.range
    const shoots = !isMeleeRange(range)
    const reach = isMeleeRange(range) ? getReach(row.weapon, range) : getShotReach(row.atk, row.weapon, c)
    return !best || reach > best.reach ? { reach, shoots } : best
  }, null)
  longest.set(c, made)
  return made
}

const getLongestReach = (c: CampaignCharacter): number => getLongestAttack(c)?.reach ?? 0

// Every cell the character, standing at `from`, walks to within `steps`
// cells, with the fewest cells it walks there and the way, the nearest first:
// walked as the step map walks (`walkMap`), but with no round to stop at, as
// far as `steps` goes, or the whole board (`whole`). The table's walk is cut
// by the cells walked alone, whichever way they go, so every cell within
// `steps` comes with the same fewest cells and the same way as the whole
// board's walk gives it.
export type Route = { cell: Coord; steps: number; path: Coord[]; elevation: number }
type Routes = { routes: Route[]; whole: boolean }

const routeMaps = new WeakMap<SceneState, Map<string, Routes | null>>()

export function getRoutes(state: SceneState, id: string, from: Coord, steps: number): Routes | null {
  const byKey = routeMaps.get(state) ?? new Map<string, Routes | null>()
  routeMaps.set(state, byKey)
  const key = `${id}|${coordKey(from)}`
  const known = byKey.get(key)
  if (byKey.has(key) && (!known || known.whole || known.routes.some((r) => r.steps >= steps))) return known ?? null
  const made = walkRoutes(state, id, from, steps)
  byKey.set(key, made)
  return made
}

function walkRoutes(state: SceneState, id: string, from: Coord, steps: number): Routes | null {
  const c = state.characters[id]
  const board = state.board
  const placement = board?.placements[id]
  if (!c || !board || !placement) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0 && o.block.AP > 0 && o.kind !== 'jump')
  const walk = open.find((o) => o.kind === 'walk') ?? open[0]
  if (!walk) return null
  // enough blocks to walk `steps` cells, or every cell of the board
  const all = Math.ceil(extentCells(board.origin, board.extent).length / walk.speed)
  const blocks = Math.min(all, Math.ceil(steps / walk.speed))
  const there = sameCell(placement.cell, from) ? placement : placeAt(board, placement, from)
  const rich = withPlacements({ ...state, characters: { ...state.characters, [id]: { ...c, resources: { ...c.resources, AP: blocks * walk.block.AP, STA: Math.max(c.resources.STA, blocks * walk.block.STA) } } } }, { [id]: there })
  const walked = getKeptWalk(rich, makeAction('move', { id: 'route-map', actorId: id, movement: walk.kind })).map(({ cell, steps, path, elevation }) => ({ cell, steps, path, elevation }))
  return { routes: [{ cell: from, steps: 0, path: [], elevation: there.elevation }, ...walked].sort((x, y) => x.steps - y.steps), whole: blocks === all }
}

// Whether `a` standing in `r.cell` on the floor there at `r.elevation` meets
// `d` standing at `at` with `attack`: a shot along a line of fire from its
// eyes there, a strike across the melee gap the table measures.
function meetsFrom(state: SceneState, a: string, d: string, at: Coord, r: Route, attack: NonNullable<LongestAttack>): boolean {
  const board = state.board
  const ca = state.characters[a]
  const cd = state.characters[d]
  const pa = board?.placements[a]
  const pd = board?.placements[d]
  if (!board || !ca || !cd || !pa || !pd) return true
  const there = { ...pa, cell: r.cell, elevation: r.elevation, climb: null }
  const target = sameCell(pd.cell, at) ? pd : placeAt(board, pd, at)
  if (!attack.shoots) return getMeleeGap(board, getBodyAt(ca, there), getBodyAt(cd, target)) <= attack.reach
  const eyes = board.levels.length ? { from: r.elevation + getHeight(ca), to: target.elevation + getHeight(cd) } : getEyes(state, a, d)
  return firesAcross(board, [r.cell], [at], eyes)
}

// The actual distance to attack (the user's ruling, 2026-11-22): the fewest
// cells `a`, standing at `from`, walks to stand where its furthest-reaching
// attack (`getLongestAttack`) meets `d` standing at `at` (a shot along a line
// of fire, a strike across the melee gap the table measures), and the way
// there. Walked as the table walks (`getRoutes`): around walls and bodies, up
// and down only what can be walked, however many rounds it takes. Null where
// no walk gets there, or `a` has nothing to attack with.
export type AttackRoute = { steps: number; path: Coord[] }

const attackRoutes = new WeakMap<SceneState, Map<string, AttackRoute | null>>()
const ROUTE_STEPS = 12

export function getAttackRoute(state: SceneState, a: string, d: string, from: Coord | null = cellOf(state, a), at: Coord | null = cellOf(state, d)): AttackRoute | null {
  const c = state.characters[a]
  if (!c || !from || !at || !state.board) return null
  const byKey = attackRoutes.get(state) ?? new Map<string, AttackRoute | null>()
  attackRoutes.set(state, byKey)
  const key = `${a}|${d}|${coordKey(from)}|${coordKey(at)}`
  if (byKey.has(key)) return byKey.get(key) ?? null
  const attack = getLongestAttack(c)
  let made: AttackRoute | null = null
  // walked `ROUTE_STEPS` cells out, then twice as far each time nothing meets
  // `d`, as far as the board goes: the nearest cell that meets it within a
  // walk is the nearest of all (`getRoutes`)
  for (let steps = ROUTE_STEPS; attack; steps *= 2) {
    const walked = getRoutes(state, a, from, steps)
    if (!walked) break
    const hit = walked.routes.find((r) => distance(r.cell, at) <= attack.reach && meetsFrom(state, a, d, at, r, attack))
    if (hit) made = { steps: hit.steps, path: hit.path }
    if (hit || walked.whole) break
  }
  byKey.set(key, made)
  return made
}

// Whether `a`, from where it stands, cannot come within its longest reach of
// `at` in a fresh round, so that no attack of its can reach there.
function isOutOfReach(state: SceneState, a: string, at: Coord | null): boolean {
  const c = state.characters[a]
  if (!c || !at || !state.board) return false
  return stepsWithin(state, a, at, getLongestReach(c)) === null
}

// Whether `a` has someone of another party it can reach in a fresh round, other
// than `d`: a pair out of reach is left unread only while there is such a one
// to weigh instead.
const reachesOthers = new WeakMap<SceneState, Map<string, boolean>>()

function hasOtherInReach(state: SceneState, a: string, d: string): boolean {
  const byKey = reachesOthers.get(state) ?? new Map<string, boolean>()
  reachesOthers.set(state, byKey)
  const key = `${a}|${d}`
  const known = byKey.get(key)
  if (known !== undefined) return known
  const party = state.partyOf[a]
  const found = Object.keys(state.characters).some((e) => e !== a && e !== d && state.partyOf[e] !== party && !isDown(state, e) && !isOutOfReach(state, a, cellOf(state, e)))
  byKey.set(key, found)
  return found
}

// A pair not worth reading: `a`, standing where it stands, cannot reach `d`
// at `at`, and has someone else it can.
function isSkipped(state: SceneState, a: string, from: Coord | null, d: string, at: Coord | null): boolean {
  const here = cellOf(state, a)
  if (!here || !from || !sameCell(here, from)) return false
  return isOutOfReach(state, a, at) && hasOtherInReach(state, a, d)
}

// A threat asked of a state, read once: by the tuning, then by the rest of
// the question. Of `plays`, only whether it holds the two counts.
const threats = new WeakMap<SceneState, WeakMap<ThreatTuning, Map<string, Threat | null>>>()

function remembered(state: SceneState, tuning: ThreatTuning, key: string, read: () => Threat | null): Threat | null {
  let byTuning = threats.get(state)
  if (!byTuning) threats.set(state, (byTuning = new WeakMap()))
  let byKey = byTuning.get(tuning)
  if (!byKey) byTuning.set(tuning, (byKey = new Map()))
  if (byKey.has(key)) return byKey.get(key) ?? null
  const made = read()
  byKey.set(key, made)
  return made
}

const cellText = (c: Coord | null): string => (c ? coordKey(c) : '-')

// `a`'s potential threat on `d` standing at `at`, were `a` standing at
// `from`: a fresh round.
export function getPotentialThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), from: Coord | null = cellOf(state, a), tuning: ThreatTuning): Threat | null {
  return remembered(state, tuning, `potential|${a}|${plays.includes(a)}|${d}|${plays.includes(d)}|${cellText(at)}|${cellText(from)}`, () => {
    const ca = state.characters[a]
    const cd = state.characters[d]
    if (!ca || !cd || isSkipped(state, a, from, d, at)) return null
    const means = freshMeans(getMeans(ca, plays.includes(a), tuning))
    return makeThreat({ state, id: a, at: from }, { state, id: d, at }, means, getMeans(cd, plays.includes(d), tuning).STA, 'potential', tuning)
  })
}

// `a`'s immediate threat on `d` standing at `at`: this round's, with what `a`
// is believed to have left.
export function getImmediateThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), tuning: ThreatTuning): Threat | null {
  return remembered(state, tuning, `immediate|${a}|${plays.includes(a)}|${d}|${plays.includes(d)}|${cellText(at)}`, () => {
    const ca = state.characters[a]
    const cd = state.characters[d]
    if (!ca || !cd || isSkipped(state, a, cellOf(state, a), d, at)) return null
    return makeThreat({ state, id: a, at: cellOf(state, a) }, { state, id: d, at }, getMeans(ca, plays.includes(a), tuning), getMeans(cd, plays.includes(d), tuning).STA, 'now', tuning)
  })
}

// The foes' threats on one character piled up: the worst, and `pile` of the rest.
function pileUp(threats: readonly number[], tuning: ThreatTuning): number {
  const worst = threats.reduce((m, t) => Math.max(m, t), 0)
  return worst + tuning.pile * (threats.reduce((sum, t) => sum + t, 0) - worst)
}

// What a foe's threat on `id` is divided by, shared among `id` and everyone
// else of its side the foe threatens where they stand (`share`): a foe with
// several within reach strikes each of them less.
function shareOf(state: SceneState, members: readonly string[], foe: string, id: string, kind: 'potential' | 'immediate', tuning: ThreatTuning): number {
  if (tuning.share === 0) return 1
  const others = getTeam(state, members).filter((ally) => ally !== id && (kind === 'potential' ? getPotentialThreat(state, members, foe, ally, cellOf(state, ally), cellOf(state, foe), tuning) : getImmediateThreat(state, members, foe, ally, cellOf(state, ally), tuning)) !== null)
  return (1 + others.length) ** tuning.share
}

// The foes' threat on `id` standing at `at` (`pileUp`), each shared
// (`shareOf`): the potential one, against a fresh round's guard, or this
// round's, against `guard` (what `id` is believed to have left, unless said).
export function getDanger(state: SceneState, members: readonly string[], id: string, kind: 'potential' | 'immediate', at: Coord | null = cellOf(state, id), guard: { AP: number; STA: number } | undefined, tuning: ThreatTuning): number {
  const { foes } = getSides(state, members)
  const me = state.characters[id]
  const held = kind === 'potential' ? undefined : (guard ?? (me ? getMeans(me, members.includes(id), tuning) : undefined))
  return pileUp(foes.map((foe) => {
    const t = kind === 'potential' ? getPotentialThreat(state, members, foe, id, at, cellOf(state, foe), tuning) : getImmediateThreat(state, members, foe, id, at, tuning)
    return t ? (getPresence(state, foe, tuning) * threatValue(t, held)) / shareOf(state, members, foe, id, kind, tuning) : 0
  }), tuning)
}

// A foe's strikes this round on `d` standing at `at`: the strongest attack per
// AP of its pair threat on `d` (`getStrongestPerAP`), made as many times as the
// AP and STA it is believed to have left pay for once the walk in is paid
// (walls and all, the foe's step map), fractions kept: with no surge, the
// movement surge paying for the walk (what is left of it given up for the
// attack), or the combat surge, which pays for both, whichever pays for most
// (the user's ruling: a foe's reach counts its surge, as `getImmediateStrikes`
// does); or, `fresh`, in a fresh round, the round's AP and the STA it holds,
// the movement surge alone (as `getPotentialStrikes`). Null where it cannot
// walk in and make it once.
type Incoming = { t: AttackThreat; strikes: number }

const incomings = new WeakMap<SceneState, Map<string, Incoming | null>>()

function getIncoming(state: SceneState, plays: readonly string[], foe: string, d: string, at: Coord | null, tuning: ThreatTuning, fresh = false): Incoming | null {
  const byKey = incomings.get(state) ?? new Map<string, Incoming | null>()
  incomings.set(state, byKey)
  const key = `${foe}|${plays.includes(foe)}|${d}|${plays.includes(d)}|${cellText(at)}|${fresh}`
  if (byKey.has(key)) return byKey.get(key) ?? null
  const read = (): Incoming | null => {
    const ca = state.characters[foe]
    const cd = state.characters[d]
    if (!ca || !cd) return null
    const t = getStrongestPerAP(getPairThreat(ca, cd, getMeans(cd, plays.includes(d), tuning).STA, tuning, fresh ? null : cd.usedSurge))
    const held = getMeans(ca, plays.includes(foe), tuning)
    const means = fresh ? freshMeans(held) : held
    if (!t || (t.attack.needsFocus && ca.usedSurge !== 'focus' && !means.surge)) return null
    const a: Party = { state, id: foe, at: cellOf(state, foe) }
    const target: Party = { state, id: d, at }
    const moveAP = closingAP(getPace(state, foe), closingSteps(state, foe, a.at, d, at, t.attack.reach, t.attack.kind === 'shoot' ? fireLine(a, target) : meleeLine(a, target, t.attack.reach)))
    if (moveAP === null) return null
    const { cost } = t.attack
    const count = (AP: number, STA: number) => (AP < cost.AP || STA < cost.STA ? 0 : Math.min(cost.AP > 0 ? AP / cost.AP : 1, cost.STA > 0 ? STA / cost.STA : Infinity))
    const canSurge = means.surge && !(t.attack.needsFocus && ca.usedSurge !== 'focus')
    const movement = { AP: getSurgeAP('movement')(ca), STA: getSurgeSTA('movement')(ca) }
    const combat = fresh ? null : combatSurge(ca)
    const ways = [count(means.AP - moveAP, means.STA)]
    if (canSurge && moveAP > 0) ways.push(count(means.AP - Math.max(0, moveAP - movement.AP), means.STA - movement.STA))
    if (canSurge && combat) ways.push(count(means.AP + combat.AP - moveAP, means.STA - combat.STA))
    const strikes = Math.max(...ways)
    return strikes > 0 ? { t, strikes } : null
  }
  const made = read()
  byKey.set(key, made)
  return made
}

// Everyone of the side of `plays` a foe can strike this round (or, `fresh`, in
// a fresh round) where they stand.
const reached = new WeakMap<SceneState, Map<string, string[]>>()

function getReached(state: SceneState, plays: readonly string[], foe: string, tuning: ThreatTuning, fresh = false): string[] {
  const byKey = reached.get(state) ?? new Map<string, string[]>()
  reached.set(state, byKey)
  const key = `${foe}|${[...plays].sort().join(',')}|${fresh}`
  const known = byKey.get(key)
  if (known) return known
  const made = getTeam(state, plays).filter((id) => getIncoming(state, plays, foe, id, cellOf(state, id), tuning, fresh) !== null)
  byKey.set(key, made)
  return made
}

// A use the AP and STA held this round may be put to (`getRoundValue`):
// `n` times (fractions kept), each worth `value` and costing `AP` and `STA`.
type Slot = { n: number; value: number; AP: number; STA: number }

const perAP = (slot: Slot): number => slot.value / Math.max(0.1, slot.AP)

// The most `AP` and `STA` fill of `slots`, the most worth for every AP first.
function fill(slots: readonly Slot[], AP: number, STA: number): number {
  let worth = 0
  for (const slot of [...slots].sort((x, y) => perAP(y) - perAP(x))) {
    if (slot.value <= 0 || slot.n <= 0) continue
    const k = Math.max(0, Math.min(slot.n, slot.AP > 0 ? AP / slot.AP : slot.n, slot.STA > 0 ? STA / slot.STA : slot.n))
    AP -= k * slot.AP
    STA -= k * slot.STA
    worth += k * slot.value
  }
  return worth
}

// The foes' strikes on `id` standing at `at` this round, each foe's
// (`getIncoming`) shared among `id` and the others of its side the foe reaches
// where they stand (the user's ruling: not every foe's round on it alone), less
// one of `leave`'s, whose strike is the one being answered: as slots of the
// harm answering each saves with the defence it is believed to be answered
// with, and the harm they do all landing undefended; `fresh`, in a fresh round.
const defending = new WeakMap<SceneState, Map<string, { slots: Slot[]; undefended: number }>>()

function getDefendingSlots(state: SceneState, plays: readonly string[], id: string, at: Coord | null, tuning: ThreatTuning, leave?: string, fresh = false): { slots: Slot[]; undefended: number } {
  const byKey = defending.get(state) ?? new Map<string, { slots: Slot[]; undefended: number }>()
  defending.set(state, byKey)
  const key = `${id}|${[...plays].sort().join(',')}|${cellText(at)}|${leave ?? ''}|${fresh}`
  const known = byKey.get(key)
  if (known) return known
  const { foes } = getSides(state, plays)
  const slots: Slot[] = []
  let undefended = 0
  for (const foe of foes) {
    const s = getIncoming(state, plays, foe, id, at, tuning, fresh)
    if (!s) continue
    const others = getReached(state, plays, foe, tuning, fresh).filter((x) => x !== id).length
    const n = getPresence(state, foe, tuning) * Math.max(0, s.strikes / (1 + others) - (foe === leave ? 1 : 0))
    undefended += n * s.t.undefended
    slots.push({ n, value: s.t.undefended - s.t.harm, AP: s.t.defence.cost.AP, STA: s.t.defence.cost.STA })
  }
  const made = { slots, undefended }
  byKey.set(key, made)
  return made
}

// The attacks `id` standing at `at` could make this round, a foe at a time:
// the strongest per AP of its pair threat on the foe (`getStrongestPerAP`), as
// a slot of the harm each leaves, made as often as what is held pays for once
// the walk in (`moveAP`) is paid.
const attacking = new WeakMap<SceneState, Map<string, { moveAP: number; slot: Slot }[]>>()

function getAttackingSlots(state: SceneState, plays: readonly string[], id: string, at: Coord | null, tuning: ThreatTuning): { moveAP: number; slot: Slot }[] {
  const byKey = attacking.get(state) ?? new Map<string, { moveAP: number; slot: Slot }[]>()
  attacking.set(state, byKey)
  const key = `${id}|${[...plays].sort().join(',')}|${cellText(at)}`
  const known = byKey.get(key)
  if (known) return known
  const me = state.characters[id]
  const made: { moveAP: number; slot: Slot }[] = []
  for (const foe of me ? getSides(state, plays).foes : []) {
    const target = state.characters[foe]
    if (!me || !target) continue
    const t = getStrongestPerAP(getPairThreat(me, target, getMeans(target, plays.includes(foe), tuning).STA, tuning))
    if (!t || (t.attack.needsFocus && me.usedSurge !== 'focus' && me.usedSurge !== null)) continue
    const a: Party = { state, id, at }
    const d: Party = { state, id: foe, at: cellOf(state, foe) }
    const moveAP = closingAP(getPace(state, id), closingSteps(state, id, at, foe, d.at, t.attack.reach, t.attack.kind === 'shoot' ? fireLine(a, d) : meleeLine(a, d, t.attack.reach)))
    if (moveAP === null) continue
    const { AP, STA } = t.attack.cost
    made.push({ moveAP, slot: { n: AP > 0 || STA > 0 ? Infinity : 1, value: getPresence(state, foe, tuning) * t.harm, AP, STA } })
  }
  byKey.set(key, made)
  return made
}

// What `id` standing at `at` can still save or do this round with what it
// holds (the user's ruling: whether a defence is worth making is whether the
// AP and STA it takes would do more answering another attack, or attacking;
// a character may take a turn at any time in the round): the most its AP and
// STA fill of the foes' strikes still to come on it, and of its own strikes
// on one foe once the walk in is paid, all as harm. `leave` is the foe whose
// strike is being answered, left out of those still to come.
export function getRoundValue(state: SceneState, plays: readonly string[], id: string, at: Coord | null, tuning: ThreatTuning, leave?: string): (AP: number, STA: number) => number {
  const { slots } = getDefendingSlots(state, plays, id, at, tuning, leave)
  const attacks = getAttackingSlots(state, plays, id, at, tuning)
  return (AP, STA) => attacks.reduce((most, a) => (AP - a.moveAP >= a.slot.AP ? Math.max(most, fill([...slots, a.slot], AP - a.moveAP, STA)) : most), fill(slots, AP, STA))
}

// The most harm `id` standing at `at` can do one foe with `AP` and `STA`: its
// strongest attack per AP on the foe (`getAttackingSlots`), as often as they
// pay for once the walk in is paid.
export function getStrikeValue(state: SceneState, plays: readonly string[], id: string, at: Coord | null, AP: number, STA: number, tuning: ThreatTuning): number {
  return getAttackingSlots(state, plays, id, at, tuning).reduce((most, a) => (AP - a.moveAP >= a.slot.AP ? Math.max(most, fill([a.slot], AP - a.moveAP, STA)) : most), 0)
}

// What an AP is worth to `id` standing at `at` this round: the most for every
// AP of the uses its round value fills (`getRoundValue`), answering a foe's
// strike or striking a foe.
export function getAPValue(state: SceneState, plays: readonly string[], id: string, at: Coord | null, tuning: ThreatTuning): number {
  const { slots } = getDefendingSlots(state, plays, id, at, tuning)
  const attacks = getAttackingSlots(state, plays, id, at, tuning)
  return [...slots, ...attacks.map((a) => a.slot)].reduce((most, slot) => (slot.value > 0 && slot.n > 0 ? Math.max(most, perAP(slot)) : most), 0)
}

// What spending `spent` of `held` STA is worth to `c` (the user's ruling): the
// IL it bleeds, 2 harm each (combat.tex "Bleed": every STA spent bleeding adds
// its IL), and the AP it would have bought, its main use (the combat surge's
// AP for its STA, each at `APvalue`, `getAPValue`), dearer the less is left,
// `STAScale` over what is left.
export function getSTAWorth(c: CampaignCharacter, spent: number, held: number, APvalue: number, tuning: ThreatTuning): number {
  if (spent <= 0) return 0
  const STA = getSurgeSTA('combat')(c)
  const bought = STA > 0 ? getSurgeAP('combat')(c) / STA : 1
  return spent * (2 * c.injuries.bleed + (APvalue * bought * tuning.STAScale) / Math.max(1, held - spent))
}

// How `id` standing at `at` comes out of the round, holding `guard` (the
// user's ruling: a place is worth what its AP and STA can do there): the harm
// the foes' strikes there would do it all landing undefended
// (`getDefendingSlots`), less what its AP and STA save answering them or do
// striking whoever it reaches from there (`getRoundValue`).
export function getOutcome(state: SceneState, plays: readonly string[], id: string, at: Coord | null, guard: { AP: number; STA: number }, tuning: ThreatTuning): number {
  return getDefendingSlots(state, plays, id, at, tuning).undefended - getRoundValue(state, plays, id, at, tuning)(guard.AP, guard.STA)
}

// The harm `id` standing at `at` is believed to take this round, answering
// with `guard` (the user's ruling: every foe's strikes on it, by its AP left,
// not the whole of every foe's round on it alone): the foes' strikes
// (`getDefendingSlots`) all landing undefended, less what `guard` saves
// answering them, the most saved for every AP first; `fresh`, the foes' strikes
// in a fresh round.
export function getHarmTaken(state: SceneState, plays: readonly string[], id: string, at: Coord | null, guard: { AP: number; STA: number }, tuning: ThreatTuning, fresh = false): number {
  const { slots, undefended } = getDefendingSlots(state, plays, id, at, tuning, undefined, fresh)
  return undefended - fill(slots, guard.AP, guard.STA)
}

// The defence an AP is worth to `id` standing at `at` (the user's ruling,
// 2026-11-22): what a whole round's AP, or `guard`'s where it holds more, and
// `guard`'s STA save answering the foes' strikes this round (the harm of them
// all landing undefended less the harm best defended), over that AP. Every AP
// spent on something else loses that share, the first as much as the last.
export function getDefencePerAP(state: SceneState, plays: readonly string[], id: string, at: Coord | null, guard: { AP: number; STA: number }, tuning: ThreatTuning): number {
  const { slots } = getDefendingSlots(state, plays, id, at, tuning)
  const round = Math.max(ROUND_AP, guard.AP)
  return fill(slots, round, guard.STA) / round
}

// What spending on a defence costs `target`, standing at `at` with `guard`,
// as it is believed to read it (`getRoundValue`): what the AP and STA spent
// would have saved or done otherwise this round, `attacker`'s strike being
// the one answered.
export function getTargetSpend(state: SceneState, target: string, attacker: string, at: Coord | null, guard: { AP: number; STA: number }, tuning: ThreatTuning): SpendCost {
  const value = getRoundValue(state, [target], target, at, tuning, attacker)
  const held = value(guard.AP, guard.STA)
  return (spent) => held - value(Math.max(0, guard.AP - spent.AP), Math.max(0, guard.STA - spent.STA))
}

// The seat's side: its members and their allies.
export const getTeam = (state: SceneState, members: readonly string[]): string[] => {
  const { mine, allies } = getSides(state, members)
  return [...mine, ...allies]
}

// How threatened a foe is: the whole team's potential threat on it.
export function getThreatened(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning): number {
  return getTeam(state, members).reduce((sum, id) => sum + threatValue(getPotentialThreat(state, members, id, foe, cellOf(state, foe), cellOf(state, id), tuning)), 0)
}

// How threatening a foe is: its worst potential threat on anyone of the team.
export function getThreatening(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning): number {
  return getTeam(state, members).reduce((worst, id) => Math.max(worst, threatValue(getPotentialThreat(state, members, foe, id, cellOf(state, id), cellOf(state, foe), tuning))), 0)
}
