import type { CampaignCharacter, Coord, MovementKind, Third } from '../types'
import type { SceneState } from '../scene/types'
import { getMovementOptions, getWalkableCells } from '../scene/rules/move'
import { makeAction } from '../scene/factories'
import { coordKey, disk, distance, parseCoordKey, sameCell } from '../scene/rules/board/geometry'
import { getDistancePenalty } from '../character/rules/gear'
import { getSTA } from '../character/rules/characteristics'
import { getSurgeAP, getSurgeSTA } from '../character/rules/surge'
import { ROUND_AP } from '../tables'
import { getPair, harmOf, type PairAttack, type PairDefence } from './pairs'
import { getExpectedHarm } from './odds'
import { getSides } from './table'

// The threat one character puts on another (the user's rulings, 2026-11-14):
// the harm of one attack times its chance, against the defence the target
// would answer with, with what the attack and the move to it cost kept apart
// so they can be weighed where the threat is used.
//
// Potential threat is threat at all: one attack after a fresh round of
// movement (8 AP and the movement surge), counted in full when it can be made
// in one round and damped when it takes two (`ring2`), nothing past that.
// Immediate threat is this round's: one attack the attacker can still pay for
// with what it is believed to have left. A target that cannot be harmed even
// undefended, or not this round, is under no threat from it.
//
// What a seat knows of a character it does not play is its face: which third
// of a round's AP and of its STA it has left, taken at the end `end` says.
// Nothing here decides; it reads.

export type ThreatTuning = {
  // what a threat that takes two rounds counts for
  ring2: number
  // the end of a face's third taken as what a character has left
  end: 'least' | 'most'
}

export const THREAT_TUNING: ThreatTuning = { ring2: 0.5, end: 'least' }

export type Threat = {
  // expected harm of the attack, against the defence the target answers with
  harm: number
  attack: PairAttack
  defence: PairDefence
  // what the attack costs, and the AP of the move it needs first
  cost: { AP: number; STA: number }
  moveAP: number
  rounds: 1 | 2
}

export const threatValue = (t: Threat | null, tuning: ThreatTuning = THREAT_TUNING): number => (t ? t.harm * (t.rounds === 1 ? 1 : tuning.ring2) : 0)

// The least or the most a third of `most` could hold (character/lenses/face.ts
// `thirdOf`).
export function fromThird(third: Third, most: number, end: ThreatTuning['end']): number {
  if (end === 'most') return Math.floor((most * (third + 1)) / 3)
  return third === 0 ? 0 : Math.floor((most * third) / 3) + 1
}

export type Means = { AP: number; STA: number; surge: boolean }

// What a character has left this round as the seat takes it: its own sheet
// for one it plays, the face for anyone else.
export function getMeans(c: CampaignCharacter, plays: boolean, tuning: ThreatTuning = THREAT_TUNING): Means {
  const surge = c.usedSurge === null
  if (plays || !c.shown) return { AP: c.resources.AP, STA: c.resources.STA, surge }
  return { AP: fromThird(c.shown.AP, ROUND_AP, tuning.end), STA: fromThird(c.shown.STA, getSTA(c), tuning.end), surge }
}

// A fresh round's means: the round's AP and the movement surge; STA does not
// come back with the round.
const freshMeans = (now: Means): Means => ({ AP: ROUND_AP, STA: now.STA, surge: true })

// How far the character goes and for what, at its fastest movement open: the
// metres of a block and the AP and STA a block costs.
type Pace = { metres: number; AP: number; STA: number }

const paces = new WeakMap<SceneState, Map<string, Pace | null>>()

export function getPace(state: SceneState, id: string): Pace | null {
  const byId = paces.get(state) ?? new Map<string, Pace | null>()
  paces.set(state, byId)
  if (byId.has(id)) return byId.get(id) ?? null
  const c = state.characters[id]
  const open = c ? getMovementOptions(state, c).filter((o) => o.available && o.speed > 0 && o.block.AP > 0) : []
  const best = open.reduce<(typeof open)[number] | null>((b, o) => (!b || o.speed / o.block.AP > b.speed / b.block.AP ? o : b), null)
  const pace = best ? { metres: best.speed, AP: best.block.AP, STA: best.block.STA } : null
  byId.set(id, pace)
  return pace
}

export const cellOf = (state: SceneState, id: string): Coord | null => state.board?.placements[id]?.cell ?? null

const apart = (a: Coord | null, b: Coord | null): number => (a && b ? distance(a, b) : 0)

// How many cells the character walks to each cell it can get to, counted as it
// moves (combat.tex "Movement"): around walls and bodies, on the ground it can
// stand on, as far as two fresh rounds carry it at its fastest pace. Walked at
// the walk (or the first other movement open), so the path is not bent by a
// run's turning; how fast it covers the cells is its pace's (`getPace`).
type StepMap = Map<string, number>

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
  const metres = 2 * (ROUND_AP + getSurgeAP('movement')(c)) * (pace.metres / pace.AP)
  const AP = Math.ceil(metres / walk.speed) * walk.block.AP
  const rich: SceneState = { ...state, characters: { ...state.characters, [id]: { ...c, resources: { ...c.resources, AP, STA: Math.max(c.resources.STA, Math.ceil(metres / walk.speed) * walk.block.STA) } } } }
  const map: StepMap = new Map([[coordKey(from), 0]])
  for (const r of getWalkableCells(rich, makeAction('move', { id: 'step-map', actorId: id, movement: walk.kind }))) {
    const key = coordKey(r.cell)
    if (!map.has(key) || r.steps < map.get(key)!) map.set(key, r.steps)
  }
  return map
}

// The fewest cells `mover` walks, from where it stands, to stand within
// `reach` of `at`; null when it cannot get there in two rounds.
function stepsWithin(state: SceneState, mover: string, at: Coord, reach: number): number | null {
  const map = getStepMap(state, mover)
  if (!map) return null
  let fewest: number | null = null
  const r = Math.floor(reach)
  if (3 * r * (r + 1) + 1 < map.size) {
    for (const cell of disk(at, r)) {
      const steps = map.get(coordKey(cell))
      if (steps !== undefined && (fewest === null || steps < fewest)) fewest = steps
    }
    return fewest
  }
  for (const [key, steps] of map) {
    const cell = parseCoordKey(key)
    if (cell && distance(cell, at) <= reach && (fewest === null || steps < fewest)) fewest = steps
  }
  return fewest
}

// The cells walked for `a`, standing at `from`, to come within `reach` of `d`
// standing at `at`. Walked from where `a` stands; for `a` supposed elsewhere,
// walked back from where `d` stands, the same way taken the other way round.
function closingSteps(state: SceneState, a: string, from: Coord | null, d: string, at: Coord | null, reach: number): number | null {
  if (!from || !at || !state.board) return 0
  if (distance(from, at) <= reach) return 0
  const here = cellOf(state, a)
  if (here && sameCell(here, from)) return stepsWithin(state, a, at, reach)
  const there = cellOf(state, d)
  if (there && sameCell(there, at)) return stepsWithin(state, d, from, reach)
  return Math.max(0, distance(from, at) - reach)
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

// The harm of the attack against a defence.
export function getHarmAgainst(attack: PairAttack, defence: PairDefence, gap: number): number {
  return getExpectedHarm(getSkillAt(attack, gap), defence.DL, attack.grazes, attack.mode, harmOf(attack, defence))
}

// The attack's harm against the defence the target answers with: the one that
// leaves the least harm, of those it can pay for, or none.
export function getDefendedHarm(attack: PairAttack, gap: number, budget: { AP: number; STA: number }): { harm: number; defence: PairDefence } | null {
  let best: { harm: number; defence: PairDefence } | null = null
  for (const defence of attack.defences) {
    if (defence.cost.AP > budget.AP || defence.cost.STA > budget.STA) continue
    const harm = getHarmAgainst(attack, defence, gap)
    if (!best || harm < best.harm) best = { harm, defence }
  }
  return best
}

type Party = { state: SceneState; id: string; at: Coord | null }

// Whether the move and the attack can be paid for: in one round, from `means`,
// the movement surge (which pays for movement only) made only when the move
// needs it; in two, the first round moving as far as it goes and the second,
// fresh, moving the rest and attacking.
function canPay(attack: PairAttack, moveAP: number, means: Means, surge: { AP: number; STA: number }, focused: boolean, rounds: 1 | 2): boolean {
  if (attack.needsFocus && !focused && !means.surge) return false
  const canSurge = means.surge && !(attack.needsFocus && !focused)
  if (rounds === 2) {
    const reach = canSurge ? surge.AP : 0
    const left = Math.max(0, moveAP - (ROUND_AP + reach))
    return Math.max(0, left - reach) + attack.cost.AP <= ROUND_AP && attack.cost.STA <= means.STA
  }
  if (moveAP + attack.cost.AP <= means.AP) return attack.cost.STA <= means.STA
  return canSurge && Math.max(0, moveAP - surge.AP) + attack.cost.AP <= means.AP && attack.cost.STA + surge.STA <= means.STA
}

// The best one attack `a` can make on `d` with `means`, within `rounds` (1 or
// 2) rounds of movement, against `d` defending with `guard`.
function bestAttack(a: Party, d: Party, means: Means, rounds: 1 | 2, guard: { AP: number; STA: number }): Threat | null {
  const attacker = a.state.characters[a.id]
  const defender = d.state.characters[d.id]
  if (!attacker || !defender) return null
  const gap = apart(a.at, d.at)
  const pace = getPace(a.state, a.id)
  const surge = { AP: getSurgeAP('movement')(attacker), STA: getSurgeSTA('movement')(attacker) }
  const focused = attacker.usedSurge === 'focus'
  let best: Threat | null = null
  for (const attack of getPair(attacker, defender)) {
    const moveAP = closingAP(pace, closingSteps(a.state, a.id, a.at, d.id, d.at, attack.reach))
    if (moveAP === null || !canPay(attack, moveAP, means, surge, focused, rounds)) continue
    const met = getDefendedHarm(attack, gap, guard)
    if (!met || met.harm <= 0) continue
    if (!best || met.harm > best.harm) best = { harm: met.harm, attack, defence: met.defence, cost: attack.cost, moveAP, rounds }
  }
  return best
}

// `a`'s potential threat on `d` standing at `at`, were `a` standing at
// `from`: a fresh round, then the next.
export function getPotentialThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), from: Coord | null = cellOf(state, a), tuning: ThreatTuning = THREAT_TUNING): Threat | null {
  const ca = state.characters[a]
  const cd = state.characters[d]
  if (!ca || !cd) return null
  const means = freshMeans(getMeans(ca, plays.includes(a), tuning))
  const guard = { AP: ROUND_AP, STA: getMeans(cd, plays.includes(d), tuning).STA }
  const by: Party = { state, id: a, at: from }
  const to: Party = { state, id: d, at }
  return bestAttack(by, to, means, 1, guard) ?? bestAttack(by, to, means, 2, guard)
}

// `a`'s immediate threat on `d` standing at `at`, defending with `guard` (what
// `d` is believed to have left, unless said).
export function getImmediateThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), guard?: { AP: number; STA: number }, tuning: ThreatTuning = THREAT_TUNING): Threat | null {
  const ca = state.characters[a]
  const cd = state.characters[d]
  if (!ca || !cd) return null
  const means = getMeans(ca, plays.includes(a), tuning)
  const held = guard ?? getMeans(cd, plays.includes(d), tuning)
  return bestAttack({ state, id: a, at: cellOf(state, a) }, { state, id: d, at }, means, 1, held)
}

// The worst single foe's threat on `id` standing at `at`: the potential one,
// or this round's with `guard` left to defend.
export function getDanger(state: SceneState, members: readonly string[], id: string, kind: 'potential' | 'immediate', at: Coord | null = cellOf(state, id), guard?: { AP: number; STA: number }, tuning: ThreatTuning = THREAT_TUNING): number {
  const { foes } = getSides(state, members)
  return foes.reduce((worst, foe) => Math.max(worst, threatValue(kind === 'potential' ? getPotentialThreat(state, members, foe, id, at, cellOf(state, foe), tuning) : getImmediateThreat(state, members, foe, id, at, guard, tuning), tuning)), 0)
}

// The seat's side: its members and their allies.
export const getTeam = (state: SceneState, members: readonly string[]): string[] => {
  const { mine, allies } = getSides(state, members)
  return [...mine, ...allies]
}

// How threatened a foe is: the whole team's potential threat on it.
export function getThreatened(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning = THREAT_TUNING): number {
  return getTeam(state, members).reduce((sum, id) => sum + threatValue(getPotentialThreat(state, members, id, foe, cellOf(state, foe), cellOf(state, id), tuning), tuning), 0)
}

// How threatening a foe is: its worst potential threat on anyone of the team.
export function getThreatening(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning = THREAT_TUNING): number {
  return getTeam(state, members).reduce((worst, id) => Math.max(worst, threatValue(getPotentialThreat(state, members, foe, id, cellOf(state, id), cellOf(state, foe), tuning), tuning)), 0)
}
